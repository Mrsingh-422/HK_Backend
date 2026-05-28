const Doctor = require('../../../models/Doctor');
const Appointment = require('../../../models/Appointment');
const Specialization = require('../../../models/Specialization');
const Prescription = require('../../../models/Prescription');
const Availability = require('../../../models/Availability'); // For slots
const Coupon = require('../../../models/Coupon'); // For coupons
const DeliveryCharge = require('../../../models/DeliveryCharge'); // For home visit charges
const User = require('../../../models/User');
const DocReschleduleLimit = require("../../../models/DocRescheduleLimit"); 
const { generateTimeSlots } = require('../../../utils/timeSlotHelper');
const { getDistance } = require('../../../utils/helpers');
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
        const { speciality, city, search, consultationType, userLat, userLng } = req.body;
        
        let query = { role: 'doctor', profileStatus: 'Approved', isActive: true };

        // 1. Basic Filters
        if (speciality) query.speciality = speciality;
        if (city) query.city = { $regex: city, $options: 'i' };
        if (search) query.name = { $regex: search, $options: 'i' };

        // 2. Consultation Type Filter (Figma Requirement)
        if (consultationType === 'Video Consult') {
            query['consultationStatus.online'] = true;
        } else if (consultationType === 'Clinic Visit') {
            query['consultationStatus.clinic'] = true;
        } else if (consultationType === 'Home Visit') {
            query['consultationStatus.home'] = true;
        }

        let doctors = await Doctor.find(query)
            .select('-password -token')
            .populate('hospitalId', 'name')
            .lean(); // .lean() use karein taaki hum easily new fields (distance) add kar sakein

        // 3. Distance Calculation Logic
        // Promise.all use karein taaki loop fast chale
        const doctorsWithDistance = await Promise.all(doctors.map(async (doc) => {
            let distance = 0;
            
            // Agar doctor aur user dono ke coordinates hain
            if (userLat && userLng && doc.location && doc.location.lat && doc.location.lng) {
                distance = await getDistance(
                    parseFloat(userLat), 
                    parseFloat(userLng), 
                    doc.location.lat, 
                    doc.location.lng
                );
            }

            return {
                ...doc,
                distance: distance // KM mein distance add ho jayega
            };
        }));

        // 4. Sort by distance (Optional: Pass true from frontend if needed)
        doctorsWithDistance.sort((a, b) => a.distance - b.distance);

        res.json({ 
            success: true, 
            count: doctorsWithDistance.length, 
            data: doctorsWithDistance 
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. GET DOCTOR PROFILE DETAILS
// endpoint: GET /user/doctors/details/:id
const getDoctorDetails = async (req, res) => {
    try {
        const doctorId = req.params.id;

        const doctorDoc = await Doctor.findById(doctorId)
            .populate('hospitalId', 'name address city')
            .select('-password -token');

        if (!doctorDoc) return res.status(404).json({ message: "Doctor not found" });

        // 1. Fetch Doctor's Availability Config
        const availability = await Availability.findOne({ vendorId: doctorId, vendorType: 'Doctor' });

        // 2. Format Working Hours for Figma UI
        let workingHoursDisplay = [];
        const allDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

        if (availability) {
            // Hum days ko group kar rahe hain (e.g., Mon-Fri)
            const workDays = allDays.filter(day => !availability.offDays.includes(day));
            const closedDays = availability.offDays;

            // Simple Display Logic for Flutter
            workingHoursDisplay = [
                {
                    days: workDays.length > 0 ? `${workDays[0].slice(0,3)} - ${workDays[workDays.length-1].slice(0,3)}` : "Not Available",
                    time: `${availability.startTime} - ${availability.endTime}`,
                    isClosed: false
                }
            ];

            if (closedDays.length > 0) {
                workingHoursDisplay.push({
                    days: closedDays.join(", "),
                    time: "Urgent cases only / Closed",
                    isClosed: true
                });
            }
        } else {
            // Default if not set
            workingHoursDisplay = [{ days: "Mon - Fri", time: "09:00 AM - 05:00 PM", isClosed: false }];
        }

        const doctor = doctorDoc.toObject();

        res.json({ 
            success: true, 
            data: {
                profile: {
                    ...doctor,
                    experience: `${doctor.experienceYears}+ years`,
                    // FIGMA: Working Hours Section (Dynamic)
                    workingHours: workingHoursDisplay,
                    
                    // FIGMA: Other Professional Info
                    helpWith: doctor.treatedConditions || ["Fever", "Cough", "Headache"],
                    competencies: doctor.competencies || ["MD Degree", "Emergency Care"],
                },
                activeServices: [
                    { type: 'Clinic Visit', fee: doctor.fees.clinic, active: doctor.consultationStatus.clinic },
                    { type: 'Video Consult', fee: doctor.fees.online, active: doctor.consultationStatus.online },
                    { type: 'Home Visit', fee: doctor.fees.home, active: doctor.consultationStatus.home }
                ]
            } 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// endpoint: GET /user/doctors/visit-charges/:doctorId
const getDoctorVisitConfig = async (req, res) => {
    try {
        const { doctorId } = req.params;
        const charges = await DeliveryCharge.findOne({ vendorId: doctorId, vendorType: 'Doctor' });
        
        if (!charges) {
            return res.json({ 
                success: true, 
                data: { fixedPrice: 100, fixedDistance: 3, pricePerKM: 10 }, // Global Default
                isDefault: true 
            });
        }
        res.json({ success: true, data: charges });
    } catch (error) { res.status(500).json({ message: error.message }); }
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
        const { 
            doctorId, consultationType, couponCode, 
            distance = 0, timeSlot, appointmentDate, 
            specialServices = [], patients = [], address = null 
        } = req.body;

        const doctor = await Doctor.findById(doctorId);
        if (!doctor) return res.status(404).json({ message: "Doctor not found" });

        // 1. Base Consultation Fee
        const typeMap = { 'Video Consult': 'online', 'Clinic Visit': 'clinic', 'Home Visit': 'home' };
        let baseFee = doctor.fees[typeMap[consultationType]] || 0;

        // 2. Visit/Travel Charges Calculation (For Home Visit only)
        let visitCharge = 0;
        if (consultationType === 'Home Visit') {
            if (!address) return res.status(400).json({ message: "Address required for Home Visit" });

            // Doctor ki specific visit charge config uthayein
            const chargeConfig = await DeliveryCharge.findOne({ vendorId: doctorId, vendorType: 'Doctor' });
            
            if (chargeConfig) {
                visitCharge = chargeConfig.fixedPrice; // Base Travel Fee
                if (distance > chargeConfig.fixedDistance) {
                    visitCharge += (distance - chargeConfig.fixedDistance) * chargeConfig.pricePerKM;
                }
            } else {
                visitCharge = 100; // Default fallback if no config set
            }
        }

        // 3. Premium Slot Fee
        let premiumFee = 0;
        const avail = await Availability.findOne({ vendorId: doctorId, vendorType: 'Doctor' });
        const slot = avail?.premiumSlots.find(s => s.time === timeSlot);
        if (slot) premiumFee = slot.extraFee;

        // 4. Special Services & Subtotal
        const servicesTotal = specialServices.reduce((sum, s) => sum + (s.price || 0), 0);
        let subtotal = baseFee + visitCharge + premiumFee + servicesTotal;

        // 5. Coupon Logic
        let discount = 0;
        if (couponCode) {
            const coupon = await Coupon.findOne({ couponName: couponCode.toUpperCase(), isActive: true });
            if (coupon && subtotal >= coupon.minOrderAmount) {
                discount = Math.min((subtotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
            }
        }

        res.json({
            success: true,
            data: {
                baseFee,
                visitCharge, // <-- This is the Dynamic Travel Fee from Doctor Panel
                premiumFee,
                servicesTotal,
                discount,
                subtotal,
                totalPayable: subtotal - discount,
                patients,
                address: consultationType === 'Home Visit' ? address : null
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// --- C. UPDATED BOOK APPOINTMENT (With Discount & Charges) ---
// Updated POST /user/doctors/book
// POST /user/doctors/book
// bookAppointment controller (Updated)
// --- UNIFIED BOOKING CONTROLLER (Works for both Independent & Hospital Doctors) ---
const bookAppointment = async (req, res) => {
    try {
        console.log("Incoming Request Body:", req.body);

        // --- Frontend ki keys ke hisaab se destructure karein ---
        let { 
            doctorId, 
            appointmentDate, 
            timeSlot,          // <--- Frontend se 'timeSlot' aa raha hai
            consultationType, 
            patients, 
            address,
            pricingBreakdown,  // <--- Frontend se 'pricingBreakdown' aa raha hai
            totalAmount        // <--- Frontend se 'totalAmount' aa raha hai
        } = req.body;

        // 1. Keys mapping (Agar frontend change nahi karna chahte)
        const appointmentTime = timeSlot; 
        const pricingData = pricingBreakdown; 

        // 2. STICKY VALIDATIONS
        if (!doctorId || !appointmentDate || !appointmentTime) {
            return res.status(400).json({ 
                success: false, 
                message: "Doctor, Date and Time (timeSlot) are mandatory." 
            });
        }

        if (!pricingData || typeof totalAmount === 'undefined') {
            return res.status(400).json({ 
                success: false, 
                message: "Pricing details or totalAmount missing." 
            });
        }

        // 3. Check Slot Availability
        const isBooked = await Appointment.findOne({ 
            doctorId, 
            appointmentDate, 
            appointmentTime, 
            status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor'] } 
        });

        if (isBooked) {
            return res.status(400).json({ success: false, message: "This slot is already booked." });
        }

        const bookingId = `HK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        
        // 4. Create Appointment using the mapped keys
        const appointment = await Appointment.create({
            userId: req.user.id,
            doctorId,
            patients: typeof patients === 'string' ? JSON.parse(patients) : patients,
            address: consultationType === 'Home Visit' ? (typeof address === 'string' ? JSON.parse(address) : address) : undefined,
            appointmentDate: new Date(appointmentDate),
            appointmentTime, // "10:00"
            consultationType,
            
            pricingBreakdown: {
                baseFee: Number(pricingData.baseFee || 0),
                visitCharges: Number(pricingData.visitCharges || 0),
                extraCharges: Number(pricingData.extraCharges || 0),
                discountAmount: Number(pricingData.discountAmount || 0),
                subtotal: Number(pricingData.subtotal || totalAmount)
            },
            
            totalAmount: Number(totalAmount),
            bookingId,
            status: 'Confirmed',
            paymentStatus: 'Paid',
            'tracking.otp': Math.floor(1000 + Math.random() * 9000).toString()
        });

        res.status(201).json({ success: true, bookingId, data: appointment });

    } catch (error) { 
        console.error("Critical Booking Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
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
// 6. CANCEL APPOINTMENT (User Side - Secure Cancellation-Reschedule Loop)
const userCancelAppointment = async (req, res) => {
    try {
        const { reason } = req.body;
        const appointment = await Appointment.findOne({ _id: req.params.id, userId: req.user.id });

        if (!appointment) return res.status(404).json({ message: "Appointment not found" });
        
        // In-progress ya completed cases cancel nahi ho sakte
        if (['In-Progress', 'Completed'].includes(appointment.status)) {
            return res.status(400).json({ message: "Cannot cancel appointment in its current state" });
        }

        if (appointment.status.startsWith('Cancelled')) {
            return res.status(400).json({ message: "This appointment is already cancelled." });
        }

        // 1. Fetch Dynamic Global limit configuration for Doctors
        const globalConfig = await DocRescheduleLimit.findOne();
        const maxLimit = globalConfig ? globalConfig.maxLimit : 2;

        const currentCancelCount = appointment.cancellationCount || 0;

        // 2. STRICT CHECK: Limit reach hone par cancel block ho jayega
        if (currentCancelCount >= maxLimit) {
            return res.status(400).json({
                success: false,
                message: `Cancellation Blocked: Aap is appointment ko maximum ${maxLimit} baar hi cancel kar sakte hain. Limit reached.`
            });
        }

        // 3. Status set to Cancelled & increment counter safely
        appointment.status = 'Cancelled-By-User';
        appointment.cancellationCount = currentCancelCount + 1;
        appointment.cancellationDetails = {
            cancelledBy: req.user.id,
            reason: reason || "Cancelled by user",
            cancelledAt: new Date()
        };
        
        appointment.paymentStatus = 'Refund-Initiated'; // Maintaining original refund pipeline

        await appointment.save();
        res.json({ 
            success: true, 
            message: "Appointment cancelled successfully. You can reschedule this appointment.", 
            cancellationLeft: maxLimit - appointment.cancellationCount,
            data: appointment 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- NEW API: RESCHEDULE DOCTOR APPOINTMENT ---
const rescheduleAppointment = async (req, res) => {
    try {
        const { appointmentId, newDate, newTimeSlot } = req.body;

        if (!appointmentId || !newDate || !newTimeSlot) {
            return res.status(400).json({ success: false, message: "Appointment, Date, and TimeSlot are mandatory." });
        }

        const appt = await Appointment.findOne({ _id: appointmentId, userId: req.user.id });
        if (!appt) return res.status(404).json({ success: false, message: "Appointment record not found." });

        // 1. Fetch Dynamic Global limit configuration for Doctors
        const globalConfig = await DocRescheduleLimit.findOne();
        const maxLimit = globalConfig ? globalConfig.maxLimit : 2;

        const currentRescheduleCount = appt.rescheduleCount || 0;

        // 2. RULE 1: Reschedule Count Validation (Checks against global admin limit)
        if (currentRescheduleCount >= maxLimit) {
            return res.status(400).json({
                success: false,
                message: `Reschedule failed: Aapki maximum reschedule limit (${maxLimit} times) poori ho chuki hai.`
            });
        }

        // 3. RULE 2: Target Slot Availability Checking (Overlaps checking)
        const isBooked = await Appointment.findOne({
            _id: { $ne: appointmentId },
            doctorId: appt.doctorId,
            appointmentDate: new Date(newDate),
            appointmentTime: newTimeSlot,
            status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor'] }
        });

        if (isBooked) {
            return res.status(400).json({ success: false, message: "Naya selected slot pehle se hi kisi aur patient ke liye booked hai." });
        }

        // 4. Update and Save changes
        appt.appointmentDate = new Date(newDate);
        appt.appointmentTime = newTimeSlot;
        appt.rescheduleCount = currentRescheduleCount + 1;
        appt.status = 'Confirmed'; // Wapas active state par return laya gaya

        await appt.save();
        res.json({ success: true, message: "Appointment rescheduled successfully", data: appt });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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
// GET /user/doctors/slots/:doctorId?date=2026-03-20
const getAvailableSlots = async (req, res) => {
    try {
        const { doctorId } = req.params;
        const { date } = req.query; // e.g., "2026-05-20"
        
        // 1. Availability config fetch karein
        const config = await Availability.findOne({ vendorId: doctorId, vendorType: 'Doctor' });
        
        if (!config) {
            return res.json({ success: true, message: "Availability not set", slots:[] });
        }

        // 2. Off-days check karein
        const dayName = moment(date).format('dddd'); 
        if (config.offDays.includes(dayName) || config.blockedDates.includes(date)) {
            return res.json({ success: true, message: "Doctor is unavailable on this date", slots:[] });
        }

        // 3. Existing Bookings fetch karein
        const booked = await Appointment.find({ 
            doctorId, 
            appointmentDate: date, 
            status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor'] } 
        }).select('appointmentTime');
        
        const bookedTimes = booked.map(b => b.appointmentTime);

        // 4. Slots Generate karein
        let slots = [];
        let start = moment(config.startTime, "HH:mm");
        let end = moment(config.endTime, "HH:mm");

        while (start.isBefore(end)) {
            const timeStr = start.format("HH:mm");
            
            // Check if blocked or booked
            const isBooked = bookedTimes.includes(timeStr);
            const isBlocked = config.unavailableSlots.includes(timeStr);

            // --- PREMIUM FEE LOGIC ---
            // Check karein kya ye time slot premium list mein hai
            const premiumEntry = config.premiumSlots.find(p => p.time === timeStr);
            const premiumFee = premiumEntry ? premiumEntry.extraFee : 0;

            slots.push({
                time: timeStr,
                isBooked: isBooked,
                isBlocked: isBlocked,
                available: !isBooked && !isBlocked,
                // UI ke liye extra data
                premiumFee: premiumFee, 
                // Agar premium hai to total fee = Base Fee + Premium Fee dikha sakte hain
            });
            
            start.add(config.slotDuration || 30, 'minutes');
        }

        res.json({ 
            success: true, 
            date, 
            baseFee: 0, // Frontend yahan doctor ki base fee pass kar sakta hai ya profile se le sakta hai
            slots 
        });
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
    getDoctorDetails, getDoctorVisitConfig,
    getAvailableCoupons,validateCoupon,
    getCheckoutSummary,
    bookAppointment, 
    verifyTrackingOTP,
    getUserAppointments,
    userCancelAppointment,rescheduleAppointment,
    trackAppointment ,
    getMyPrescriptions,
    getAvailableSlots,getTrackingStatus,getShareableTrackingLink
};