// controllers/user/Doctor/BookAppointment.js
const Doctor = require('../../../models/Doctor');
const Appointment = require('../../../models/Appointment');
const Specialization = require('../../../models/Specialization');
const Prescription = require('../../../models/Prescription');
const Availability = require('../../../models/Availability'); // For slots
const Coupon = require('../../../models/Coupon'); // For coupons
const DeliveryCharge = require('../../../models/DeliveryCharge'); // For home visit charges
const User = require('../../../models/User');
const DocRescheduleLimit = require("../../../models/DocRescheduleLimit"); 
const { generateTimeSlots } = require('../../../utils/timeSlotHelper');
const { getDistance } = require('../../../utils/helpers');
const { createRazorpayOrder, verifyRazorpaySignature, fetchAndMapRazorpayPayment } = require('../../../utils/razorpay'); // 👈 Razorpay Helpers Imported
const moment = require('moment');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Review = require('../../../models/Review'); // For dynamic ratings calculation

const Bed = require('../../../models/Bed'); // For hospital admissions
const { sendPushNotification, notifyAdminsAndVendor } = require('../../../utils/notification'); // For Notifications

// 1. GET ALL SPECIALIZATIONS (For dropdown)
const getSpecializations = async (req, res) => {
    try {
        const list = await Specialization.find({ isActive: true });
        res.json({ success: true, data: list });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. SEARCH & FILTER DOCTORS (Website & App Listing)
const searchDoctors = async (req, res) => {
    try {
        const { speciality, city, search, consultationType, userLat, userLng } = req.body;
        
        let query = { role: 'doctor', profileStatus: 'Approved', isActive: true };

        if (speciality) query.speciality = speciality;
        if (city) query.city = { $regex: city, $options: 'i' };
        if (search) query.name = { $regex: search, $options: 'i' };

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
            .lean();

        const doctorsWithDistance = await Promise.all(doctors.map(async (doc) => {
            let distance = 0;
            
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
                distance: distance 
            };
        }));

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
const getDoctorDetails = async (req, res) => {
    try {
        const doctorId = req.params.id;

        const doctorDoc = await Doctor.findById(doctorId)
            .populate('hospitalId', 'name address city')
            .select('-password -token');

        if (!doctorDoc) return res.status(404).json({ message: "Doctor not found" });

        // =========================================================================
        // 🚨 DYNAMIC RATINGS & REVIEWS CALCULATOR (For Doctor Profile)
        // =========================================================================
        const reviews = await Review.find({ 
            targetId: doctorId, 
            targetType: 'Doctor' 
        }).select('rating').lean();

        let averageRating = 4.8; // Default fallback if no reviews exist in DB yet
        if (reviews.length > 0) {
            const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
            // Format to 1 decimal place (e.g. 4.3)
            averageRating = Number((totalRating / reviews.length).toFixed(1)); 
        }

        // Fetch last 3 recent reviews specifically for this Doctor
        const recentReviews = await Review.find({ targetId: doctorId, targetType: 'Doctor' })
            .select('userName rating comment createdAt')
            .sort({ createdAt: -1 })
            .limit(3)
            .lean();

        const availability = await Availability.findOne({ vendorId: doctorId, vendorType: 'Doctor' });

        let workingHoursDisplay = [];
        const allDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

        if (availability) {
            const workDays = allDays.filter(day => !availability.offDays.includes(day));
            const closedDays = availability.offDays;

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
            workingHoursDisplay = [{ days: "Mon - Fri", time: "09:00 AM - 05:00 PM", isClosed: false }];
        }

        const doctor = doctorDoc.toObject();

        res.json({ 
            success: true, 
            data: {
                profile: {
                    ...doctor,
                    averageRating: averageRating,   // 👈 Dynamic average rating
                    totalReviews: reviews.length,  // 👈 Dynamic total reviews count
                    experience: `${doctor.experienceYears}+ years`,
                    workingHours: workingHoursDisplay,
                    helpWith: doctor.treatedConditions || ["Fever", "Cough", "Headache"],
                    competencies: doctor.competencies || ["MD Degree", "Emergency Care"],
                },
                activeServices: [
                    { type: 'Clinic Visit', fee: doctor.fees.clinic, active: doctor.consultationStatus.clinic },
                    { type: 'Video Consult', fee: doctor.fees.online, active: doctor.consultationStatus.online },
                    { type: 'Home Visit', fee: doctor.fees.home, active: doctor.consultationStatus.home }
                ],
                recentReviews // 👈 Added live last 3 user reviews
            } 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// GET VISIT CONFIG
const getDoctorVisitConfig = async (req, res) => {
    try {
        const { doctorId } = req.params;
        const charges = await DeliveryCharge.findOne({ vendorId: doctorId, vendorType: 'Doctor' });
        
        if (!charges) {
            return res.json({ 
                success: true, 
                data: { fixedPrice: 100, fixedDistance: 3, pricePerKM: 10 }, 
                isDefault: true 
            });
        }
        res.json({ success: true, data: charges });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// GET APPLICABLE COUPONS
const getAvailableCoupons = async (req, res) => {
    try {
        const { doctorId } = req.params;
        const coupons = await Coupon.find({
            isActive: true,
            expiryDate: { $gt: new Date() },
            $or: [
                { vendorId: doctorId }, 
                { isAdminCreated: true, vendorType: { $in: ['Doctor', 'All'] } } 
            ]
        });
        res.json({ success: true, data: coupons });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// VALIDATE COUPON
const validateCoupon = async (req, res) => {
    try {
        const { couponCode, subtotal, doctorId } = req.body;
        const userId = req.user.id;

        if (!couponCode || !subtotal || !doctorId) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const coupon = await Coupon.findOne({ 
            couponName: couponCode.toUpperCase(), 
            isActive: true 
        });

        if (!coupon) {
            return res.status(404).json({ success: false, message: "Invalid or inactive coupon code" });
        }

        if (new Date(coupon.expiryDate) < new Date()) {
            return res.status(400).json({ success: false, message: "Coupon has expired" });
        }

        const numericSubtotal = Number(subtotal);
        if (numericSubtotal < Number(coupon.minOrderAmount)) {
            return res.status(400).json({ 
                success: false, 
                message: `Minimum amount of ₹${coupon.minOrderAmount} required for this coupon` 
            });
        }

        if (coupon.vendorId && coupon.vendorId.toString() !== doctorId) {
            return res.status(400).json({ success: false, message: "This coupon is not applicable for this doctor" });
        }

        const userUsage = coupon.usedBy.find(u => u.userId.toString() === userId);
        if (userUsage && userUsage.usageCount >= coupon.maxUsagePerUser) {
            return res.status(400).json({ success: false, message: "You have exceeded the usage limit for this coupon" });
        }

        let discount = (numericSubtotal * Number(coupon.discountPercentage)) / 100;
        
        if (discount > Number(coupon.maxDiscount)) {
            discount = Number(coupon.maxDiscount);
        }

        res.json({
            success: true,
            message: "Coupon applied successfully!",
            data: {
                couponId: coupon._id,
                discountAmount: Math.round(discount), 
                finalAmount: Math.round(numericSubtotal - discount)
            }
        });

    } catch (error) {
        console.error("Coupon Validation Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET CHECKOUT SUMMARY
const getCheckoutSummary = async (req, res) => {
    try {
        const { 
            doctorId, consultationType, couponCode, 
            distance = 0, timeSlot, appointmentDate, 
            specialServices = [], patients = [], address = null 
        } = req.body;

        const doctor = await Doctor.findById(doctorId);
        if (!doctor) return res.status(404).json({ message: "Doctor not found" });

        const typeMap = { 'Video Consult': 'online', 'Clinic Visit': 'clinic', 'Home Visit': 'home' };
        let baseFee = doctor.fees[typeMap[consultationType]] || 0;

        let visitCharge = 0;
        if (consultationType === 'Home Visit') {
            if (!address) return res.status(400).json({ message: "Address required for Home Visit" });

            const chargeConfig = await DeliveryCharge.findOne({ vendorId: doctorId, vendorType: 'Doctor' });
            
            if (chargeConfig) {
                visitCharge = chargeConfig.fixedPrice; 
                if (distance > chargeConfig.fixedDistance) {
                    visitCharge += (distance - chargeConfig.fixedDistance) * chargeConfig.pricePerKM;
                }
            } else {
                visitCharge = 100; 
            }
        }

        let premiumFee = 0;
        const avail = await Availability.findOne({ vendorId: doctorId, vendorType: 'Doctor' });
        const slot = avail?.premiumSlots.find(s => s.time === timeSlot);
        if (slot) premiumFee = slot.extraFee;

        const servicesTotal = specialServices.reduce((sum, s) => sum + (s.price || 0), 0);
        let subtotal = baseFee + visitCharge + premiumFee + servicesTotal;

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
                visitCharge, 
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

// --- C. BOOK APPOINTMENT (INTEGRATED WITH RAZORPAY ORDER CREATION) ---
// Mapped only for Independent Doctors (Role check added) [1]
const bookAppointment = async (req, res) => {
    try {
        console.log("Incoming Appointment Booking Request:", req.body);

        let { 
            doctorId, 
            appointmentDate, 
            timeSlot,          
            consultationType, 
            patients, 
            address,
            pricingBreakdown,  
            totalAmount        
        } = req.body;

        const appointmentTime = timeSlot; 
        const pricingData = pricingBreakdown; 

        // 1. Basic Validations
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

        // 2. Strict Independent Doctor Role Validation [1]
        const doctor = await Doctor.findById(doctorId);
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found." });
        }
        if (doctor.role !== 'doctor') {
            return res.status(400).json({ 
                success: false, 
                message: "This booking route only supports independent doctors." 
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

        const tempBookingId = `HK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        // 4. Create Razorpay Order in paise (1 INR = 100 paise)
        const rzpOrder = await createRazorpayOrder(totalAmount, `receipt_${tempBookingId}`);

        // 5. Create Draft/Unpaid Appointment Record in MongoDB
        const appointment = await Appointment.create({
            userId: req.user.id,
            doctorId,
            patients: typeof patients === 'string' ? JSON.parse(patients) : patients,
            address: consultationType === 'Home Visit' ? (typeof address === 'string' ? JSON.parse(address) : address) : undefined,
            appointmentDate: new Date(appointmentDate),
            appointmentTime, 
            consultationType,
            
            pricingBreakdown: {
                baseFee: Number(pricingData.baseFee || 0),
                visitCharges: Number(pricingData.visitCharges || 0),
                extraCharges: Number(pricingData.extraCharges || 0),
                discountAmount: Number(pricingData.discountAmount || 0),
                subtotal: Number(pricingData.subtotal || totalAmount)
            },
            
            totalAmount: Number(totalAmount),
            bookingId: tempBookingId,
            status: 'Pending', // Pending payment signature verification
            paymentStatus: 'Pending',
            transactionId: rzpOrder.id, // Store Razorpay Order ID as tracker
            'tracking.otp': Math.floor(1000 + Math.random() * 9000).toString()
        });

        // 6. Return Razorpay configurations to Mobile/Web Frontend
        res.status(201).json({ 
            success: true, 
            message: "Razorpay order created. Complete payment to confirm.",
            key_id: process.env.RAZORPAY_KEY_ID, // Send key_id securely
            amount: rzpOrder.amount, // in paise
            razorpayOrderId: rzpOrder.id,
            appointmentId: appointment._id,
            bookingId: tempBookingId
        });

    } catch (error) { 
        console.error("Critical Booking Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- NEW METHOD: VERIFY PAYMENT AND CONFIRM APPOINTMENT ---
// endpoint: POST /user/doctors/verify-payment
const verifyDoctorPayment = async (req, res) => {
    try {
        const { appointmentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

        if (!appointmentId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(400).json({ 
                success: false, 
                message: "All payment tokens (orderId, paymentId, signature) are mandatory." 
            });
        }

        const isVerified = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        if (!isVerified) {
            return res.status(400).json({ success: false, message: "Signature verification failed." });
        }

        const rzpDetails = await fetchAndMapRazorpayPayment(razorpayPaymentId, razorpaySignature);

        const appointment = await Appointment.findByIdAndUpdate(
            appointmentId,
            {
                $set: {
                    status: 'Confirmed',
                    paymentStatus: 'Paid',
                    transactionId: razorpayPaymentId,
                    paymentDetails: rzpDetails 
                }
            },
            { new: true }
        ).populate('doctorId', 'name speciality');

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment record not found." });
        }

        // 🚨 Trigger Notification for Doctor & Admins
        await notifyAdminsAndVendor(
            appointment.doctorId._id,
            'doctor',
            "New Appointment Confirmed!",
            `Appointment scheduled on ${moment(appointment.appointmentDate).format('YYYY-MM-DD')} at ${appointment.appointmentTime}.`,
            { appointmentId: appointment._id.toString(), type: 'new_appointment' }
        );

        res.json({
            success: true,
            message: "Payment verified successfully. Booking is now Confirmed!",
            data: appointment
        });

    } catch (error) {
        console.error("Signature Verification Error:", error);
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
const getUserAppointments = async (req, res) => {
    try {
        const { status } = req.query; 
        const query = { 
            userId: req.user.id, 
            bookingType: 'Appointment' 
        };        
        if (status) query.status = status; 
        
        const globalConfig = await DocRescheduleLimit.findOne();
        const maxLimit = globalConfig ? globalConfig.maxLimit : 2;

        const appointments = await Appointment.find(query)
            .populate('doctorId', 'name speciality profileImage profileStatus role')
            .sort({ appointmentDate: -1 });

        res.json({ 
            success: true, 
            count: appointments.length, 
            maxRescheduleLimit: maxLimit, 
            data: appointments 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 6. CANCEL APPOINTMENT
const userCancelAppointment = async (req, res) => {
    try {
        const { reason } = req.body;
        const appointment = await Appointment.findOne({ _id: req.params.id, userId: req.user.id });

        if (!appointment) return res.status(404).json({ message: "Appointment not found" });
        
        if (['In-Progress', 'Completed'].includes(appointment.status)) {
            return res.status(400).json({ message: "Cannot cancel appointment in its current state" });
        }

        if (appointment.status.startsWith('Cancelled')) {
            return res.status(400).json({ message: "This appointment is already cancelled." });
        }

        const globalConfig = await DocRescheduleLimit.findOne();
        const maxLimit = globalConfig ? globalConfig.maxLimit : 2;

        const currentCancelCount = appointment.cancellationCount || 0;
        const currentRescheduleCount = appointment.rescheduleCount || 0; 

        if (currentRescheduleCount >= maxLimit) {
            return res.status(400).json({
                success: false,
                message: `Cancellation Blocked: Aapka reschedule limit (${maxLimit} times) pehle hi khatam ho chuka hai, isliye aap is appointment ko ab cancel nahi kar sakte.`
            });
        }

        if (currentCancelCount >= maxLimit) {
            return res.status(400).json({
                success: false,
                message: `Cancellation Blocked: Aap is appointment ko maximum ${maxLimit} baar hi cancel kar sakte hain.`
            });
        }

        appointment.status = 'Cancelled-By-User';
        appointment.cancellationCount = currentCancelCount + 1;
        appointment.cancellationDetails = {
            cancelledBy: req.user.id,
            reason: reason || "Cancelled by user",
            cancelledAt: new Date()
        };
        
        appointment.paymentStatus = 'Refund-Initiated'; 

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

// RESCHEDULE
const rescheduleAppointment = async (req, res) => {
    try {
        const { appointmentId, newDate, newTimeSlot } = req.body;

        if (!appointmentId || !newDate || !newTimeSlot) {
            return res.status(400).json({ success: false, message: "Appointment, Date, and TimeSlot are mandatory." });
        }

        const appt = await Appointment.findOne({ _id: appointmentId, userId: req.user.id });
        if (!appt) return res.status(404).json({ success: false, message: "Appointment record not found." });

        const globalConfig = await DocRescheduleLimit.findOne();
        const maxLimit = globalConfig ? globalConfig.maxLimit : 2;

        const currentRescheduleCount = appt.rescheduleCount || 0;

        if (currentRescheduleCount >= maxLimit) {
            return res.status(400).json({
                success: false,
                message: `Reschedule failed: Aapki maximum reschedule limit (${maxLimit} times) poori ho chuki hai.`
            });
        }

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

        appt.appointmentDate = new Date(newDate);
        appt.appointmentTime = newTimeSlot;
        appt.rescheduleCount = currentRescheduleCount + 1;
        appt.status = 'Confirmed'; 

        await appt.save();
        res.json({ success: true, message: "Appointment rescheduled successfully", data: appt });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// TRACK
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
            otp: appointment.tracking?.otp, 
            data: appointment 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// GET PRESCRIPTIONS
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

// GET SLOTS
const getAvailableSlots = async (req, res) => {
    try {
        const { doctorId } = req.params;
        const { date } = req.query; 
        
        const config = await Availability.findOne({ vendorId: doctorId, vendorType: 'Doctor' });
        
        if (!config) {
            return res.json({ success: true, message: "Availability not set", slots:[] });
        }

        const dayName = moment(date).format('dddd'); 
        if (config.offDays.includes(dayName) || config.blockedDates.includes(date)) {
            return res.json({ success: true, message: "Doctor is unavailable on this date", slots:[] });
        }

        const booked = await Appointment.find({ 
            doctorId, 
            appointmentDate: date, 
            status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor'] } 
        }).select('appointmentTime');
        
        const bookedTimes = booked.map(b => b.appointmentTime);

        let slots = [];
        let start = moment(config.startTime, "HH:mm");
        let end = moment(config.endTime, "HH:mm");

        while (start.isBefore(end)) {
            const timeStr = start.format("HH:mm");
            
            const isBooked = bookedTimes.includes(timeStr);
            const isBlocked = config.unavailableSlots.includes(timeStr);

            const premiumEntry = config.premiumSlots.find(p => p.time === timeStr);
            const premiumFee = premiumEntry ? premiumEntry.extraFee : 0;

            slots.push({
                time: timeStr,
                isBooked: isBooked,
                isBlocked: isBlocked,
                available: !isBooked && !isBlocked,
                premiumFee: premiumFee, 
            });
            
            start.add(config.slotDuration || 30, 'minutes');
        }

        res.json({ 
            success: true, 
            date, 
            baseFee: 0, 
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
                status: appointment.status, 
                eta: "12 min", 
                otp: appointment.tracking.otp, 
                liveLocation: appointment.tracking.liveLocation,
                contact: {
                    phone: appointment.doctorId.phone,
                    chatAvailable: true
                }
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getShareableTrackingLink = async (req, res) => {
    const link = `https://hk.app/track/live/${req.params.id}`;
    res.json({ success: true, link });
};

const getUserVideoConsults = async (req, res) => {
    try {
        const userId = req.user.id; 

        const appointments = await Appointment.find({
            userId,
            bookingType: 'Appointment',            
            consultationType: 'Video Consult',      
            status: { $in: ['Confirmed', 'In-Progress'] } 
        })
        .populate('doctorId', 'name speciality profileImage') 
        .sort({ appointmentDate: 1, appointmentTime: 1 });   

        const formattedData = appointments.map(app => {
            const mainPatient = app.patients[0]; 
            
            return {
                appointmentId: app._id,
                bookingId: app.bookingId,
                patientName: mainPatient?.patientName || "Self",
                patientAge: mainPatient?.patientAge || "N/A",
                patientGender: mainPatient?.gender || "N/A",
                reasonForVisit: mainPatient?.reasonForVisit || "General Consultation",
                appointmentDate: app.appointmentDate,
                appointmentTime: app.appointmentTime,
                status: app.status,
                totalAmount: app.totalAmount,
                
                doctorDetails: {
                    doctorId: app.doctorId?._id,
                    name: app.doctorId?.name || "Unknown Doctor",
                    speciality: app.doctorId?.speciality || "General Physician",
                    profileImage: app.doctorId?.profileImage || null
                },

                isCallActionEnabled: app.status === 'In-Progress' || app.status === 'Confirmed'
            };
        });

        res.json({
            success: true,
            count: formattedData.length,
            data: formattedData
        });

    } catch (error) {
        console.error("Error in getUserVideoConsults:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const rateDoctorAppointment = async (req, res) => {
    try {
        const { bookingId, rating, comment } = req.body;

        // 1. Validation checks
        if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
            return res.status(400).json({ success: false, message: "Valid Booking ID (ObjectId) format is required." });
        }

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: "Valid rating (1 to 5) is required." });
        }

        // 2. Fetch the completed Doctor Appointment
        const booking = await Appointment.findOne({ 
            _id: new mongoose.Types.ObjectId(bookingId), 
            userId: req.user.id, 
            bookingType: 'Appointment' 
        });

        if (!booking) {
            return res.status(404).json({ success: false, message: "Doctor appointment booking not found." });
        }

        if (booking.status !== 'Completed') {
            return res.status(400).json({ 
                success: false, 
                message: `You can only rate completed appointments. Current status is: ${booking.status}` 
            });
        }

        // 3. Prevent duplicate reviews
        const existingReview = await Review.findOne({ userId: req.user.id, orderId: booking._id });
        if (existingReview) {
            return res.status(400).json({ success: false, message: "You have already submitted a review for this appointment." });
        }

        // 4. Create Polymorphic Review
        await Review.create({
            userId: req.user.id,
            userName: req.user.name || "Verified User",
            targetId: booking.doctorId,
            targetType: 'Doctor',
            orderId: booking._id,
            rating: Number(rating),
            comment: comment || ""
        });

        // 5. Recalculate average rating
        const stats = await Review.aggregate([
            { 
                $match: { 
                    targetId: new mongoose.Types.ObjectId(booking.doctorId), 
                    targetType: 'Doctor' 
                } 
            },
            { 
                $group: { 
                    _id: null, 
                    averageRating: { $avg: "$rating" }, 
                    totalReviews: { $sum: 1 } 
                } 
            }
        ]);

        if (stats.length > 0) {
            const newRating = Number(stats[0].averageRating.toFixed(1));
            const totalReviews = stats[0].totalReviews;

            await Doctor.findByIdAndUpdate(booking.doctorId, {
                averageRating: newRating,
                totalReviews: totalReviews
            });
        }

        res.json({ success: true, message: "Thank you for rating your doctor consultation!" });
    } catch (error) {
        // 🚨 Is code ke zariye terminal ke bajay direct API response me hi poora error dikhega
        console.error("RATE DOCTOR APPOINTMENT EXCEPTION:", error);
        res.status(500).json({ 
            success: false, 
            message: "Internal Server Error: " + error.message, 
            error_stack: error.stack // 👈 Yeh exact error trace karega
        });
    }
};




module.exports = { 
    getSpecializations, 
    searchDoctors, 
    getDoctorDetails, getDoctorVisitConfig,
    getAvailableCoupons,validateCoupon,
    getCheckoutSummary,
    bookAppointment, 
    verifyDoctorPayment, // 👈 New Verification Exported
    verifyTrackingOTP,
    getUserAppointments,
    userCancelAppointment,rescheduleAppointment,
    trackAppointment ,
    getMyPrescriptions,
    getAvailableSlots,getTrackingStatus,getShareableTrackingLink,
    getUserVideoConsults, rateDoctorAppointment
};