const Doctor = require('../../../models/Doctor');
const Appointment = require('../../../models/Appointment');
const Specialization = require('../../../models/Specialization');
const Prescription = require('../../../models/Prescription');
const Availability = require('../../../models/Availability'); // For slots
const Coupon = require('../../../models/Coupon'); // For coupons
const DeliveryCharge = require('../../../models/DeliveryCharge'); // For home visit charges
const { generateTimeSlots } = require('../../../utils/timeSlotHelper');
const moment = require('moment');
const crypto = require('crypto');

// 1. GET ALL SPECIALIZATIONS (For dropdown)
// endpoint: GET /user/doctors/specializations
const getSpecializations = async (req, res) => {
    try {
        const list = await Specialization.find({ isActive: true });
        res.json({ success: true, data: list });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. SEARCH & FILTER DOCTORS (Website & App Listing)
// endpoint: GET /user/doctors/list?speciality=Cardiologist&city=Mohali
const searchDoctors = async (req, res) => {
    try {
        const { speciality, city, search, role, videoCall, availableNow } = req.query;
        let query = { profileStatus: 'Approved', isActive: true };

        if (speciality) query.speciality = speciality;
        if (city) query.city = { $regex: city, $options: 'i' };
        if (role) query.role = role; 
        if (search) query.name = { $regex: search, $options: 'i' };

        // Figma Toggle: Video Call available
        if (videoCall === 'true') {
            query['fees.online'] = { $gt: 0 };
        }

        const doctors = await Doctor.find(query)
            .select('-password -token')
            .populate('hospitalId', 'name');

        res.json({ success: true, count: doctors.length, data: doctors });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. GET DOCTOR PROFILE DETAILS
// endpoint: GET /user/doctors/details/:id
const getDoctorDetails = async (req, res) => {
    try {
        const doctor = await Doctor.findById(req.params.id).populate('hospitalId', 'name address');
        if (!doctor) return res.status(404).json({ message: "Doctor not found" });
        res.json({ success: true, data: doctor });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- A. GET APPLICABLE COUPONS FOR A DOCTOR ---
// endpoint: GET /user/doctors/coupons/:doctorId
const getAvailableCoupons = async (req, res) => {
    try {
        const { doctorId } = req.params;
        const coupons = await Coupon.find({
            isActive: true,
            expiryDate: { $gt: new Date() },
            $or: [
                { vendorId: doctorId }, // Specific to this doctor
                { isAdminCreated: true, vendorType: { $in: ['Doctor', 'All'] } } // Global Doctor Coupons
            ]
        });
        res.json({ success: true, data: coupons });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
const validateCoupon = async (req, res) => {
    try {
        const { couponCode, subtotal, doctorId } = req.body;
        const userId = req.user.id;

        // 1. Input Validation
        if (!couponCode || !subtotal || !doctorId) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        // 2. Find Coupon
        const coupon = await Coupon.findOne({ 
            couponName: couponCode.toUpperCase(), 
            isActive: true 
        });

        if (!coupon) {
            return res.status(404).json({ success: false, message: "Invalid or inactive coupon code" });
        }

        // 3. Expiry Check
        if (new Date(coupon.expiryDate) < new Date()) {
            return res.status(400).json({ success: false, message: "Coupon has expired" });
        }

        // 4. Minimum Order Amount Check (Ensure numbers)
        const numericSubtotal = Number(subtotal);
        if (numericSubtotal < Number(coupon.minOrderAmount)) {
            return res.status(400).json({ 
                success: false, 
                message: `Minimum amount of ₹${coupon.minOrderAmount} required for this coupon` 
            });
        }

        // 5. Vendor Specific Check (If not global)
        if (coupon.vendorId && coupon.vendorId.toString() !== doctorId) {
            return res.status(400).json({ success: false, message: "This coupon is not applicable for this doctor" });
        }

        // 6. Usage Limit Check
        const userUsage = coupon.usedBy.find(u => u.userId.toString() === userId);
        if (userUsage && userUsage.usageCount >= coupon.maxUsagePerUser) {
            return res.status(400).json({ success: false, message: "You have exceeded the usage limit for this coupon" });
        }

        // 7. Discount Calculation (Safe math)
        let discount = (numericSubtotal * Number(coupon.discountPercentage)) / 100;
        
        // Cap the discount to maxDiscount
        if (discount > Number(coupon.maxDiscount)) {
            discount = Number(coupon.maxDiscount);
        }

        // 8. Return Success
        res.json({
            success: true,
            message: "Coupon applied successfully!",
            data: {
                couponId: coupon._id,
                discountAmount: Math.round(discount), // Rounded to avoid decimals
                finalAmount: Math.round(numericSubtotal - discount)
            }
        });

    } catch (error) {
        console.error("Coupon Validation Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// --- B. CHECKOUT SUMMARY (Calculate Price Breakdown) ---
// endpoint: POST /user/doctors/checkout-summary
const getCheckoutSummary = async (req, res) => {
    try {
        const { doctorId, consultationType, couponCode, distance = 0 } = req.body;

        const doctor = await Doctor.findById(doctorId);
        if (!doctor) return res.status(404).json({ message: "Doctor not found" });

        // 1. Base Fee
        let baseFee = 0;
        if (consultationType === 'Home Visit') baseFee = doctor.fees.home;
        else if (consultationType === 'Video Consult') baseFee = doctor.fees.online;
        else baseFee = doctor.fees.clinic;

        // 2. Visit/Travel Charges (Only for Home Visit)
        let visitCharge = 0;
        if (consultationType === 'Home Visit') {
            const chargeConfig = await DeliveryCharge.findOne({ vendorId: doctorId }) || {
                fixedPrice: 100, fixedDistance: 3, pricePerKM: 10 // Default fallback
            };

            visitCharge = chargeConfig.fixedPrice;
            if (distance > chargeConfig.fixedDistance) {
                visitCharge += (distance - chargeConfig.fixedDistance) * chargeConfig.pricePerKM;
            }
        }

        let subtotal = baseFee + visitCharge;

        // 3. Coupon Discount
        let discount = 0;
        let appliedCoupon = null;

        if (couponCode) {
            const coupon = await Coupon.findOne({ couponName: couponCode.toUpperCase(), isActive: true });
            if (coupon) {
                // Validation: Expiry, Min Amount, Max Usage
                const isExpired = new Date(coupon.expiryDate) < new Date();
                const isMinMet = subtotal >= coupon.minOrderAmount;

                if (!isExpired && isMinMet) {
                    discount = (subtotal * coupon.discountPercentage) / 100;
                    if (discount > coupon.maxDiscount) discount = coupon.maxDiscount;
                    appliedCoupon = coupon.couponName;
                }
            }
        }

        const totalPayable = subtotal - discount;

        res.json({
            success: true,
            data: {
                baseFee,
                visitCharge,
                subtotal,
                discount,
                couponApplied: appliedCoupon,
                totalPayable,
                currency: "$"
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- C. UPDATED BOOK APPOINTMENT (With Discount & Charges) ---
// Updated POST /user/doctors/book
// POST /user/doctors/book
// bookAppointment controller (Updated)
const bookAppointment = async (req, res) => {
    try {
        const { doctorId, appointmentDate, appointmentTime, consultationType, patients, pricing, couponId, couponCode } = req.body;

        if (!pricing) return res.status(400).json({ success: false, message: "Pricing data missing" });

        // Slot Validation... (same as before)

        let bookingId = `HK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const totalAmount = Number(pricing.totalAmount) || 0;

        const appointmentData = {
            userId: req.user.id,
            doctorId,
            patients: typeof patients === 'string' ? JSON.parse(patients) : patients,
            appointmentDate: new Date(appointmentDate),
            appointmentTime,
            consultationType,
            pricingBreakdown: {
                baseFee: Number(pricing.baseFee) || 0,
                visitCharges: Number(pricing.visitCharges) || 0,
                extraCharges: Number(pricing.extraCharges) || 0,
                subtotal: Number(pricing.subtotal) || 0,
                discountAmount: Number(pricing.discountAmount) || 0
            },
            totalAmount: totalAmount,
            bookingId,
            status: 'Pending',
            paymentStatus: 'Paid'
        };

        // Coupon Logic...
        const appointment = await Appointment.create(appointmentData);

        res.status(201).json({ success: true, bookingId, data: appointment });
    } catch (error) {
        console.error("Booking Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};




// 4. BOOK APPOINTMENT (Hospital-Aware Logic)
// endpoint: POST /user/doctors/book
// const bookAppointment = async (req, res) => {
//     try {
//         // Patients data usually comes as stringified JSON in form-data
//         const patientsData = typeof req.body.patients === 'string' 
//             ? JSON.parse(req.body.patients) 
//             : req.body.patients;

//         const {
//             doctorId, appointmentDate, appointmentTime, 
//             consultationType, totalAmount 
//         } = req.body;

//         if (!patientsData || !Array.isArray(patientsData) || patientsData.length === 0) {
//             return res.status(400).json({ message: "Please select at least one patient" });
//         }

//         const doctor = await Doctor.findById(doctorId);
//         if (!doctor) return res.status(404).json({ message: "Doctor not found" });

//         const initialStatus = doctor.role === 'hospital-doctor' ? 'Hospital-Pending' : 'Pending';
//         const bookingId = `HK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        
//         // 🚀 Figma Logic: Generate 4-digit OTP for Tracking
//         const trackingOTP = Math.floor(1000 + Math.random() * 9000).toString();

//         const newAppointment = await Appointment.create({
//             userId: req.user.id,
//             doctorId,
//             hospitalId: doctor.hospitalId,
//             patients: patientsData,
//             appointmentDate,
//             appointmentTime,
//             consultationType,
//             totalAmount,
//             bookingId,
//             status: initialStatus, 
//             paymentStatus: 'Paid',
//             'tracking.otp': trackingOTP, // Figma tracking screen ke liye
//             medicalReport: req.file ? req.file.path : null // Figma: Upload Report
//         });

//         res.status(201).json({ 
//             success: true, 
//             message: "Booking Successful", 
//             bookingId, 
//             trackingOTP,
//             data: newAppointment 
//         });
//     } catch (error) {
//         res.status(500).json({ message: error.message });
//     }
// };

const verifyTrackingOTP = async (req, res) => {
    try {
        const { appointmentId, otp } = req.body;
        const appointment = await Appointment.findById(appointmentId);

        if (appointment.tracking.otp !== otp) {
            return res.status(400).json({ success: false, message: "Invalid OTP. Please check with the patient." });
        }

        appointment.status = 'In-Progress';
        await appointment.save();

        res.json({ success: true, message: "Visit started successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
// 5. GET USER APPOINTMENTS (Figma: My Bookings)
// endpoint: GET /user/doctors/my-appointments
const getUserAppointments = async (req, res) => {
    try {
        const { status } = req.query; 
        const query = { userId: req.user.id };
        
        // Status filters can include: Pending, Hospital-Pending, Confirmed, etc.
        if (status) query.status = status;

        const appointments = await Appointment.find(query)
            .populate('doctorId', 'name speciality profileImage profileStatus role')
            .sort({ appointmentDate: -1 });

        res.json({ success: true, count: appointments.length, data: appointments });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}; 

// 6. CANCEL APPOINTMENT (User Side)
// endpoint: PATCH /user/doctors/cancel/:id
const userCancelAppointment = async (req, res) => {
    try {
        const { reason } = req.body;
        const appointment = await Appointment.findOne({ _id: req.params.id, userId: req.user.id });

        if (!appointment) return res.status(404).json({ message: "Appointment not found" });
        
        // Block cancellation if already in progress or completed
        if (['In-Progress', 'Completed'].includes(appointment.status)) {
            return res.status(400).json({ message: "Cannot cancel appointment in its current state" });
        }

        appointment.status = 'Cancelled-By-User';
        appointment.cancellationDetails = {
            cancelledBy: req.user.id,
            reason: reason || "Cancelled by user",
            cancelledAt: new Date()
        };
        
        appointment.paymentStatus = 'Refund-Initiated'; 

        await appointment.save();
        res.json({ success: true, message: "Appointment cancelled. Refund initiated.", data: appointment });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 7. TRACK LIVE STATUS (Figma Tracking Screen)
// endpoint: GET /user/doctors/track/:appointmentId
const trackAppointment = async (req, res) => {
    try {
        const appointment = await Appointment.findOne({ 
            _id: req.params.appointmentId, 
            userId: req.user.id 
        }).populate('doctorId', 'name phone profileImage');

        if (!appointment) return res.status(404).json({ message: "Appointment not found" });

        res.json({ 
            success: true, 
            status: appointment.status,
            eta: appointment.tracking?.eta || "12 min", 
            doctorLocation: appointment.tracking?.liveLocation || { lat: 30.7333, lng: 76.7794 }, 
            otp: appointment.tracking?.otp, // Database wala real OTP
            data: appointment 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


//8. GET PRESCRIPTION & DIAGNOSIS (Figma: Prescription View Button)
// endpoint: GET /user/doctors/prescription
const getMyPrescriptions = async (req, res) => {
    try {
        const data = await Prescription.find({ userId: req.user.id })
            .populate('doctorId', 'name speciality profileImage')
            .sort({ createdAt: -1 });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// GET /user/doctors/slots/:doctorId?date=2026-03-20
const getAvailableSlots = async (req, res) => {
    try {
        const { doctorId } = req.params;
        const { date } = req.query; // e.g., "2026-05-20"
        
        // 1. Availability config fetch karein (Nurse/Doctor model ke andar nahi, alag collection se)
        const config = await Availability.findOne({ vendorId: doctorId, vendorType: 'Doctor' });
        
        if (!config) {
            return res.json({ success: true, message: "Availability not set", slots:[] });
        }

        // 2. Off-days check karein
        const dayName = moment(date).format('dddd'); // e.g., "Sunday"
        if (config.offDays.includes(dayName) || config.blockedDates.includes(date)) {
            return res.json({ success: true, message: "Doctor is unavailable on this date", slots:[] });
        }

        // 3. Existing Bookings fetch karein
        const booked = await Appointment.find({ 
            doctorId, 
            appointmentDate: date, 
            status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor'] } 
        }).select('appointmentTime');
        
        const bookedTimes = booked.map(b => b.appointmentTime); // Format match hona chahiye

        // 4. Slots Generate karein
        let slots =[];
        let start = moment(config.startTime, "HH:mm");
        let end = moment(config.endTime, "HH:mm");

        while (start.isBefore(end)) {
            const timeStr = start.format("HH:mm"); // Model mein HH:mm format hai
            
            // Check if blocked or booked
            const isBooked = bookedTimes.includes(timeStr);
            const isBlocked = config.unavailableSlots.includes(timeStr);

            slots.push({
                time: timeStr, // "09:00"
                isBooked: isBooked,
                isBlocked: isBlocked,
                available: !isBooked && !isBlocked
            });
            
            start.add(config.slotDuration || 30, 'minutes');
        }

        res.json({ success: true, date, slots });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

const getTrackingStatus = async (req, res) => {
    try {
        const appointment = await Appointment.findById(req.params.id)
            .populate('doctorId', 'name phone profileImage averageRating totalReviews');

        if (!appointment) return res.status(404).json({ message: "Appointment not found" });

        res.json({
            success: true,
            data: {
                doctorName: appointment.doctorId.name,
                status: appointment.status, // "On the way"
                eta: "12 min", // Dr. calculation logic later
                otp: appointment.tracking.otp, // Screen 22: 8902
                liveLocation: appointment.tracking.liveLocation,
                contact: {
                    phone: appointment.doctorId.phone,
                    chatAvailable: true
                }
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// B. Share Live Status (Screenshot 21)
// Sirf link generate karke dena hai
const getShareableTrackingLink = async (req, res) => {
    const link = `https://hk.app/track/live/${req.params.id}`;
    res.json({ success: true, link });
};

module.exports = { 
    getSpecializations, 
    searchDoctors, 
    getDoctorDetails, 
    getAvailableCoupons,validateCoupon,
    getCheckoutSummary,
    bookAppointment, 
    verifyTrackingOTP,
    getUserAppointments,
    userCancelAppointment,
    trackAppointment ,
    getMyPrescriptions,
    getAvailableSlots,getTrackingStatus,getShareableTrackingLink
};