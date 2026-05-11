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

const Bed = require('../../../models/Bed'); // For hospital admissions

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
        let query = {  role: 'doctor',profileStatus: 'Approved', isActive: true };

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
        const doctorDoc = await Doctor.findById(req.params.id)
            .populate('hospitalId', 'name address city')
            .select('-password -token');

        if (!doctorDoc) return res.status(404).json({ message: "Doctor not found" });

        // Doctor object ko plain JavaScript object mein convert karein
        const doctor = doctorDoc.toObject();

        // 1. Available services list banayein (Yeh aapne pehle hi sahi kiya hai)
        const activeServices = [];
        if (doctor.consultationStatus.clinic) activeServices.push({ type: 'Clinic Visit', fee: doctor.fees.clinic });
        if (doctor.consultationStatus.online) activeServices.push({ type: 'Video Consult', fee: doctor.fees.online });
        if (doctor.consultationStatus.home) activeServices.push({ type: 'Home Visit', fee: doctor.fees.home });

        // 2. Doctor object se disabled fields ko remove karein
        if (!doctor.consultationStatus.clinic) {
            delete doctor.fees.clinic;
        }
        if (!doctor.consultationStatus.online) {
            delete doctor.fees.online;
        }
        if (!doctor.consultationStatus.home) {
            delete doctor.fees.home;
        }

        res.json({ 
            success: true, 
            data: {
                profile: doctor, // Ab isme sirf wahi fees keys hongi jo active hain
                activeServices: activeServices 
            } 
        });
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
// 1. UNIFIED CHECKOUT SUMMARY (Sabse Important)
// Yeh API batayegi ki final paisa kitna lagega Admission ya Appointment ka
const getCheckoutSummary = async (req, res) => {
    try {
        const { doctorId, bedId, hospitalId, consultationType, couponCode, distance = 0, days = 1 } = req.body;

        let baseFee = 0;
        let visitCharge = 0;
        let subtotal = 0;

        // CASE A: Agar Doctor Appointment hai
        if (doctorId) {
            const doctor = await Doctor.findById(doctorId);
            if (!doctor) return res.status(404).json({ message: "Doctor not found" });

            if (consultationType === 'Home Visit') {
                baseFee = doctor.fees.home;
                // Visit Charges Calculate karein DeliveryCharge model se
                const chargeConfig = await DeliveryCharge.findOne({ vendorId: doctor.hospitalId || doctor._id });
                if (chargeConfig) {
                    visitCharge = chargeConfig.fixedPrice;
                    if (distance > chargeConfig.fixedDistance) {
                        visitCharge += (distance - chargeConfig.fixedDistance) * chargeConfig.pricePerKM;
                    }
                }
            } else if (consultationType === 'Video Consult') {
                baseFee = doctor.fees.online;
            } else {
                baseFee = doctor.fees.clinic;
            }
        } 
        // CASE B: Agar Bed Booking (Admission) hai
        else if (bedId) {
            const bed = await Bed.findById(bedId);
            if (!bed) return res.status(404).json({ message: "Bed type not found" });
            baseFee = bed.pricePerDay * days;
        }

        subtotal = baseFee + visitCharge;

        // Coupon Logic (Professional Validation)
        let discount = 0;
        let appliedCouponId = null;
        if (couponCode) {
            const coupon = await Coupon.findOne({ couponName: couponCode.toUpperCase(), isActive: true });
            if (coupon && subtotal >= coupon.minOrderAmount) {
                discount = Math.min((subtotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
                appliedCouponId = coupon._id;
            }
        }

        res.json({
            success: true,
            data: {
                baseFee,
                visitCharge,
                discount,
                subtotal,
                totalPayable: subtotal - discount,
                appliedCouponId,
                currency: "₹"
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// --- C. UPDATED BOOK APPOINTMENT (With Discount & Charges) ---
// Updated POST /user/doctors/book
// POST /user/doctors/book
// bookAppointment controller (Updated)
// --- UNIFIED BOOKING CONTROLLER (Works for both Independent & Hospital Doctors) ---
const bookAppointment = async (req, res) => {
    try {
        const { 
            doctorId, bedId, hospitalId, appointmentDate, appointmentTime, 
            consultationType, patients, pricing, couponId, couponCode 
        } = req.body;

        const bookingId = `HK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const trackingOTP = Math.floor(1000 + Math.random() * 9000).toString();

        // Agar Hospital Id missing hai toh Doctor se Admission tak ki link check karein
        let finalHospitalId = hospitalId;
        if (doctorId && !finalHospitalId) {
            const doc = await Doctor.findById(doctorId);
            finalHospitalId = doc.hospitalId;
        }

        const appointment = await Appointment.create({
            userId: req.user.id,
            doctorId: doctorId || null,
            bedId: bedId || null,
            hospitalId: finalHospitalId || null,
            bookingType: bedId ? 'Admission' : 'Appointment',
            patients: typeof patients === 'string' ? JSON.parse(patients) : patients,
            appointmentDate,
            appointmentTime: bedId ? 'Admission' : appointmentTime,
            consultationType: bedId ? 'Clinic Visit' : consultationType,
            
            pricingBreakdown: {
                baseFee: pricing.baseFee,
                visitCharges: pricing.visitCharge || 0,
                discountAmount: pricing.discount || 0,
                subtotal: pricing.subtotal
            },
            couponDetails: couponId ? { couponId, couponCode, discountValue: pricing.discount } : undefined,
            totalAmount: pricing.totalPayable,
            bookingId,
            status: finalHospitalId ? 'Hospital-Pending' : 'Pending',
            paymentStatus: 'Paid',
            'tracking.otp': trackingOTP
        });

        // Bed availability update logic
        if (bedId) {
            await Bed.findByIdAndUpdate(bedId, { $inc: { availableBeds: -1 } });
        }

        res.status(201).json({ success: true, bookingId, trackingOTP, data: appointment });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


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