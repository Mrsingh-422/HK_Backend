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
const UserSubscription = require('../../../models/UserSubscription');
const { generateTimeSlots } = require('../../../utils/timeSlotHelper');
const { getDistance } = require('../../../utils/helpers');
const { createRazorpayOrder, verifyRazorpaySignature, fetchAndMapRazorpayPayment } = require('../../../utils/razorpay'); // 👈 Razorpay Helpers Imported
const moment = require('moment');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Review = require('../../../models/Review'); // For dynamic ratings calculation

const Bed = require('../../../models/Bed'); // For hospital admissions
const { sendPushNotification, notifyAdminsAndVendor } = require('../../../utils/notification'); // For Notifications
const { checkAndApplyBenefit, deductBenefitCount,refundBenefitCount } = require('../../../utils/subscriptionBenefitHelper');
const { processCancellationRefund } = require('../../../utils/policyHelper');
const { isCodEnabled } = require('../../../utils/policyHelper'); // Ensure this is imported at the top

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
        
        // Strictly filters: Only APPROVED and ACTIVE doctors (Offline ones are included but will be marked in response)
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
            .select('-password -token') // preserves isOnline automatically as it is not excluded
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

        if (!doctorDoc || doctorDoc.isActive === false) {
            return res.status(404).json({ success: false, message: "Doctor profile is inactive or not found." });
        }

        const reviews = await Review.find({ 
            targetId: doctorId, 
            targetType: 'Doctor' 
        }).select('rating').lean();

        let averageRating = 4.8; 
        if (reviews.length > 0) {
            const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
            averageRating = Number((totalRating / reviews.length).toFixed(1)); 
        }

        const recentReviews = await Review.find({ targetId: doctorId, targetType: 'Doctor' })
            .select('userName rating comment createdAt')
            .sort({ createdAt: -1 })
            .limit(3)
            .lean();

        const availability = await Availability.findOne({ vendorId: doctorId, vendorType: 'Doctor' });

        let workingHoursDisplay = [];
        const allDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

        if (availability) {
            const offDaysList = availability.offDays || [];
            const workDays = allDays.filter(day => !offDaysList.includes(day));
            const closedDays = offDaysList;

            let workDaysLabel = "Not Available";
            if (workDays.length === 1) {
                workDaysLabel = workDays[0].slice(0, 3);
            } else if (workDays.length > 1) {
                workDaysLabel = `${workDays[0].slice(0, 3)} - ${workDays[workDays.length - 1].slice(0, 3)}`;
            }

            workingHoursDisplay = [
                {
                    days: workDaysLabel,
                    time: `${availability.startTime || '09:00'} - ${availability.endTime || '18:00'}`,
                    isClosed: workDays.length === 0
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
                    averageRating: averageRating,   
                    totalReviews: reviews.length,  
                    experience: `${doctor.experienceYears || 0}+ years`,
                    workingHours: workingHoursDisplay,
                    helpWith: (doctor.treatedConditions && doctor.treatedConditions.length > 0) ? doctor.treatedConditions : ["Fever", "Cough", "Headache"],
                    competencies: (doctor.competencies && doctor.competencies.length > 0) ? doctor.competencies : ["MD Degree", "Emergency Care"],
                    isOnline: doctor.isOnline ?? true
                },
                activeServices: [
                    { type: 'Clinic Visit', fee: doctor.fees?.clinic || 0, active: doctor.consultationStatus?.clinic ?? true },
                    { type: 'Video Consult', fee: doctor.fees?.online || 0, active: doctor.consultationStatus?.online ?? true },
                    { type: 'Home Visit', fee: doctor.fees?.home || 0, active: doctor.consultationStatus?.home ?? true }
                ],
                recentReviews 
            } 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
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

// for condtional subcription plan check, we will use the middleware requireConditionPlan in the routes for specialized disease care bookings. This middleware will ensure that only users with an active subscription for the required disease care plan can access the booking endpoints.
// @desc    Calculate Doctor Consultation Checkout Summary (Zero Static 500 Fallback & Video COD Block)
// @route   POST /user/doctors/checkout-summary
// @access  Private (User)
const getCheckoutSummary = async (req, res) => {
    try {
        const userId = req.user.id;
        const { doctorId, consultationType, timeSlot, appointmentDate, couponCode, distance } = req.body;

        if (!doctorId || !consultationType) {
            return res.status(400).json({ success: false, message: "doctorId and consultationType are required." });
        }

        if (!mongoose.isValidObjectId(doctorId)) {
            return res.status(400).json({ success: false, message: "Invalid Doctor ID format." });
        }

        const doctor = await Doctor.findById(doctorId).select('name speciality fees consultationStatus slotDuration').lean();
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor profile not found." });
        }

        // 1. Dynamic Fee Resolution Strictly From Doctor DB Record (No Arbitrary 500 Fallback!)
        let realBaseFee = 0;
        let visitCharge = 0;
        const type = String(consultationType).trim();

        if (type === 'Video Consult') {
            if (doctor.consultationStatus?.online === false) {
                return res.status(400).json({ success: false, message: "Doctor is currently not accepting video consultations." });
            }
            realBaseFee = Number(doctor.fees?.online ?? 0);
        } else if (type === 'Home Visit') {
            if (doctor.consultationStatus?.home === false) {
                return res.status(400).json({ success: false, message: "Doctor is currently not accepting home visits." });
            }
            realBaseFee = Number(doctor.fees?.home ?? 0);

            // Fetch dynamic travel charges
            const chargesConfig = await DeliveryCharge.findOne({ vendorId: doctorId, vendorType: 'Doctor' }).lean();
            if (chargesConfig) {
                const tripDistance = Math.max(0, parseFloat(distance) || 0);
                const freeDistance = Number(chargesConfig.fixedDistance || 3);
                const baseVisitFee = Number(chargesConfig.fixedPrice || 100);
                const perKmRate = Number(chargesConfig.pricePerKM || 10);
                
                const extraDistance = Math.max(0, tripDistance - freeDistance);
                visitCharge = Math.round(baseVisitFee + (extraDistance * perKmRate));
            }
        } else {
            // Default: Clinic Visit
            if (doctor.consultationStatus?.clinic === false) {
                return res.status(400).json({ success: false, message: "Doctor is currently not accepting clinic visits." });
            }
            realBaseFee = Number(doctor.fees?.clinic ?? 0);
        }

        // 2. Premium Slot Surcharge Evaluation
        let premiumSlotFee = 0;
        if (timeSlot) {
            const availability = await Availability.findOne({ vendorId: doctorId, vendorType: 'Doctor' }).lean();
            if (availability && Array.isArray(availability.premiumSlots)) {
                const cleanSlot = String(timeSlot).trim().toLowerCase();
                const matchedSlot = availability.premiumSlots.find(s => 
                    s.time && String(s.time).trim().toLowerCase() === cleanSlot
                );
                if (matchedSlot) {
                    premiumSlotFee = Number(matchedSlot.extraFee || 0);
                }
            }
        }

        // 3. Subscription Benefit (Free Doctor Consultation Waiver)
        const subBenefit = await checkAndApplyBenefit(userId, 'freeDoctorAppointmentsCount', realBaseFee);
        const isSubscriptionApplied = subBenefit.isApplied;
        const payableBaseFee = isSubscriptionApplied ? 0 : realBaseFee;

        const subtotal = payableBaseFee + visitCharge + premiumSlotFee;

        // 4. Coupon Discount Calculation
        let discount = 0;
        let appliedCoupon = null;

        if (couponCode && couponCode.trim() !== "" && subtotal > 0) {
            const coupon = await Coupon.findOne({
                couponName: couponCode.trim().toUpperCase(),
                isActive: true,
                expiryDate: { $gte: new Date() }
            });

            if (coupon && subtotal >= (coupon.minOrderAmount || 0)) {
                discount = Math.min(Math.round((subtotal * coupon.discountPercentage) / 100), coupon.maxDiscount || subtotal);
                appliedCoupon = {
                    couponId: coupon._id,
                    couponCode: coupon.couponName,
                    discountPercentage: coupon.discountPercentage,
                    discountAmount: discount
                };
            }
        }

        const totalPayable = Math.max(0, subtotal - discount);

        // 5. 🚨 STRICT COD EVALUATION: Video Consultations ALWAYS have COD Disabled!
        let isCodAvailable = false;
        let codDisabledReason = null;

        if (type === 'Video Consult') {
            isCodAvailable = false;
            codDisabledReason = "Online Video Consultation requires online payment (UPI/Card). Cash on Delivery is disabled.";
        } else {
            // Clinic Visit and Home Visit check Admin Policy & VIP Subscription
            isCodAvailable = await isCodEnabled('Doctor', userId);
            if (!isCodAvailable) {
                codDisabledReason = "Cash on Delivery is currently disabled by administrator for clinic/home doctor appointments.";
            }
        }

        res.status(200).json({
            success: true,
            isCodAvailable,
            codDisabledReason,
            data: {
                consultationType: type,
                doctorName: doctor.name,
                speciality: doctor.speciality,
                baseFee: realBaseFee,
                originalBaseFee: realBaseFee,
                visitCharge,
                premiumSlotFee,
                subtotal: realBaseFee + visitCharge + premiumSlotFee,
                discount,
                appliedCoupon,
                totalPayable,
                isCodAvailable,
                codDisabledReason,
                subscriptionDetails: {
                    isSubscriptionApplied,
                    userSubscriptionId: subBenefit.subId || null,
                    planName: subBenefit.planName || ""
                }
            }
        });

    } catch (error) {
        console.error("Doctor Checkout Summary Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// @desc    Book Doctor Appointment (Strict Backend Check: Blocks COD for Video Consultations)
// @route   POST /user/doctors/book
// @access  Private (User)
const bookAppointment = async (req, res) => {
    try {
        const userId = req.user.id;
        let {
            doctorId, consultationType, appointmentDate, appointmentTime,
            patients, paymentMethod, couponCode, distance, bookingReason,
            hasInsurance, insuranceNumber, companyName, insuranceType
        } = req.body;

        if (typeof patients === 'string') {
            try { patients = JSON.parse(patients); } catch (e) {}
        }

        if (!doctorId || !consultationType || !appointmentDate || !appointmentTime || !patients || patients.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Doctor, Consultation Type, Date, Time slot, and Patient details are required."
            });
        }

        if (!mongoose.isValidObjectId(doctorId)) {
            return res.status(400).json({ success: false, message: "Invalid Doctor ID format." });
        }

        const type = String(consultationType).trim();
        const requestedMethod = String(paymentMethod || 'Online').trim();
        const isRequestedCashOrCod = requestedMethod === 'COD' || 
                                     requestedMethod === 'Cash' || 
                                     requestedMethod.toUpperCase() === 'COD' || 
                                     requestedMethod.toUpperCase() === 'CASH';

        // 🚨 1. STRICT SECURITY & FLOW ENFORCEMENT: Block COD on Video Calls
        if (type === 'Video Consult' && isRequestedCashOrCod) {
            return res.status(400).json({
                success: false,
                errorType: "COD_NOT_ALLOWED_FOR_VIDEO_CALL",
                message: "Cash on Delivery (COD) is not allowed for Online Video Consultations. Please select Online Payment (UPI / Card / NetBanking)."
            });
        }

        const doctor = await Doctor.findById(doctorId).select('name fees consultationStatus').lean();
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found." });
        }

        // 2. Dynamic Real Base Fee Resolution (Strictly No Arbitrary 500 Number!)
        let realBaseFee = 0;
        let visitCharge = 0;

        if (type === 'Video Consult') {
            if (doctor.consultationStatus?.online === false) {
                return res.status(400).json({ success: false, message: "Doctor is currently not accepting video consultations." });
            }
            realBaseFee = Number(doctor.fees?.online ?? 0);
        } else if (type === 'Home Visit') {
            if (doctor.consultationStatus?.home === false) {
                return res.status(400).json({ success: false, message: "Doctor is currently not accepting home visits." });
            }
            realBaseFee = Number(doctor.fees?.home ?? 0);

            const chargesConfig = await DeliveryCharge.findOne({ vendorId: doctorId, vendorType: 'Doctor' }).lean();
            if (chargesConfig) {
                const tripDistance = Math.max(0, parseFloat(distance) || 0);
                const freeDistance = Number(chargesConfig.fixedDistance || 3);
                const baseVisitFee = Number(chargesConfig.fixedPrice || 100);
                const perKmRate = Number(chargesConfig.pricePerKM || 10);
                const extraDistance = Math.max(0, tripDistance - freeDistance);
                visitCharge = Math.round(baseVisitFee + (extraDistance * perKmRate));
            }
        } else {
            if (doctor.consultationStatus?.clinic === false) {
                return res.status(400).json({ success: false, message: "Doctor is currently not accepting clinic visits." });
            }
            realBaseFee = Number(doctor.fees?.clinic ?? 0);
        }

        // 3. Premium Slot Surcharge
        let premiumFee = 0;
        const availability = await Availability.findOne({ vendorId: doctorId, vendorType: 'Doctor' }).lean();
        if (availability && Array.isArray(availability.premiumSlots)) {
            const cleanSlot = String(appointmentTime).trim().toLowerCase();
            const matchedSlot = availability.premiumSlots.find(s => 
                s.time && String(s.time).trim().toLowerCase() === cleanSlot
            );
            if (matchedSlot) {
                premiumFee = Number(matchedSlot.extraFee || 0);
            }
        }

        // 4. Subscription Benefit
        const subBenefit = await checkAndApplyBenefit(userId, 'freeDoctorAppointmentsCount', realBaseFee);
        const isSubscriptionApplied = subBenefit.isApplied;
        const payableBaseFee = isSubscriptionApplied ? 0 : realBaseFee;

        const subtotal = payableBaseFee + visitCharge + premiumFee;

        // 5. Coupon Discount
        let discount = 0;
        let couponObj = null;

        if (couponCode && couponCode.trim() !== "" && subtotal > 0) {
            const coupon = await Coupon.findOne({
                couponName: couponCode.trim().toUpperCase(),
                isActive: true,
                expiryDate: { $gte: new Date() }
            });
            if (coupon && subtotal >= (coupon.minOrderAmount || 0)) {
                discount = Math.min(Math.round((subtotal * coupon.discountPercentage) / 100), coupon.maxDiscount || subtotal);
                couponObj = {
                    couponId: coupon._id,
                    couponCode: coupon.couponName,
                    discountValue: discount
                };
            }
        }

        const totalAmount = Math.max(0, subtotal - discount);

        // 6. Policy Check on Clinic / Home Visit COD
        if (isRequestedCashOrCod) {
            const codPermitted = await isCodEnabled('Doctor', userId);
            if (!codPermitted) {
                return res.status(400).json({
                    success: false,
                    errorType: "COD_POLICY_RESTRICTED",
                    message: "Cash on Delivery is currently disabled by administrator. Please pay online."
                });
            }
        }

        const cleanPaymentMethod = isRequestedCashOrCod ? 'COD' : 'Online';
        const bookingId = `HKD-${Date.now().toString().slice(-6)}${Math.floor(10 + Math.random() * 90)}`;

        const appointment = await Appointment.create({
            userId,
            doctorId,
            bookingId,
            bookingType: 'Appointment',
            consultationType: type,
            appointmentDate: new Date(appointmentDate),
            appointmentTime,
            patients: patients.map(p => ({
                patientName: p.patientName,
                patientAge: Number(p.patientAge) || 25,
                gender: p.gender || "Male",
                relation: p.relation || "Self",
                reasonForVisit: p.reasonForVisit || bookingReason || "Doctor Consultation"
            })),
            bookingReason: bookingReason || "Doctor Appointment",
            pricingBreakdown: {
                baseFee: realBaseFee,
                originalBaseFee: realBaseFee,
                visitCharges: visitCharge,
                extraCharges: premiumFee,
                discountAmount: discount,
                subtotal: realBaseFee + visitCharge + premiumFee,
                depositPaidOnBooking: cleanPaymentMethod === 'COD' ? 0 : totalAmount
            },
            totalAmount,
            paymentMethod: cleanPaymentMethod,
            paymentStatus: totalAmount === 0 ? 'Paid' : 'Pending',
            status: totalAmount === 0 ? 'Confirmed' : (cleanPaymentMethod === 'Online' ? 'Pending' : 'Confirmed'),
            couponDetails: couponObj,
            subscriptionDetails: {
                isSubscriptionApplied,
                userSubscriptionId: subBenefit.subId || null,
                planName: subBenefit.planName || ""
            },
            tracking: {
                otp: Math.floor(1000 + Math.random() * 9000).toString(),
                status: 'Confirmed'
            }
        });

        // 7. Online Payment Flow (Razorpay Order)
        if (cleanPaymentMethod === 'Online' && totalAmount > 0) {
            const rzpOrder = await createRazorpayOrder(totalAmount, `rec_doc_${bookingId}`);
            appointment.transactionId = rzpOrder.id;
            await appointment.save();

            return res.status(201).json({
                success: true,
                isOnlinePayment: true,
                message: "Appointment initiated. Complete online payment to confirm booking.",
                key_id: process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID,
                amount: rzpOrder.amount,
                currency: "INR",
                razorpayOrderId: rzpOrder.id,
                appointmentId: appointment._id,
                bookingId: appointment.bookingId,
                totalPayable: totalAmount
            });
        }

        // 8. Offline / COD / Free Subscribed Appointment
        try {
            await sendPushNotification(
                doctorId,
                'doctor',
                "New Consultation Booked!",
                `New appointment #${bookingId} booked for ${appointmentTime}.`,
                { appointmentId: appointment._id.toString(), type: 'new_appointment_booked' }
            );
        } catch (e) {}

        res.status(201).json({
            success: true,
            isOnlinePayment: false,
            message: "Doctor appointment booked successfully!",
            bookingId: appointment.bookingId,
            appointmentId: appointment._id,
            totalAmount,
            data: appointment
        });

    } catch (error) {
        console.error("Book Doctor Appointment Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// VERIFY DOCTOR PAYMENT (Universal Key Extractor, IDOR Protection & Auto Order ID Lookup)
// endpoint: POST /user/doctors/verify-payment
const verifyDoctorPayment = async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Universal Body Resolver
        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) {}
        }
        if (body.response && typeof body.response === 'object') {
            body = { ...body, ...body.response };
        }
        if (body.data && typeof body.data === 'object') {
            body = { ...body, ...body.data };
        }
        if (body.paymentDetails && typeof body.paymentDetails === 'object') {
            body = { ...body, ...body.paymentDetails };
        }

        // 2. Extract Keys (Supports all naming conventions)
        const rzpPaymentId = body.razorpay_payment_id || 
                             body.razorpayPaymentId || 
                             body.paymentId || 
                             body.payment_id || 
                             body.paymentID;

        const rzpOrderId = body.razorpay_order_id || 
                           body.razorpayOrderId || 
                           body.orderId || 
                           body.order_id || 
                           body.orderID;

        const rzpSignature = body.razorpay_signature || 
                             body.razorpaySignature || 
                             body.signature || 
                             body.razorpay_sign;

        const targetId = body.appointmentId || 
                         body.bookingMongoId || 
                         body.bookingId || 
                         body.booking_id || 
                         body.id;

        if (!rzpPaymentId) {
            return res.status(400).json({ 
                success: false, 
                message: "Missing razorpayPaymentId / razorpay_payment_id parameter." 
            });
        }

        // 3. Cryptographic Signature Verification
        let isVerified = false;
        if (rzpOrderId && rzpSignature) {
            isVerified = verifyRazorpaySignature(rzpOrderId, rzpPaymentId, rzpSignature);
        }

        if (!isVerified && (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV)) {
            console.warn("⚠️ [DEV NOTICE]: Doctor payment signature mismatch bypassed in development mode.");
            isVerified = true;
        }

        if (!isVerified && process.env.NODE_ENV === 'production') {
            return res.status(400).json({ 
                success: false, 
                message: "Signature verification failed. Invalid transaction signature." 
            });
        }

        // 4. Dynamic Booking Lookup (IDOR Protected via userId)
        const searchConditions = [];

        if (targetId) {
            if (mongoose.isValidObjectId(targetId)) {
                searchConditions.push({ _id: targetId });
            }
            searchConditions.push({ bookingId: String(targetId).trim() });
        }

        if (rzpOrderId) {
            searchConditions.push({ 'paymentDetails.razorpayOrderId': rzpOrderId });
        }

        let appointment = null;
        if (searchConditions.length > 0) {
            appointment = await Appointment.findOne({ 
                userId, 
                $or: searchConditions 
            });
        }

        // Fallback: Check most recent pending appointment for this user
        if (!appointment) {
            const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
            appointment = await Appointment.findOne({
                userId,
                paymentStatus: 'Pending',
                createdAt: { $gte: fifteenMinsAgo }
            }).sort({ createdAt: -1 });
        }

        if (!appointment) {
            return res.status(404).json({ 
                success: false, 
                message: "Doctor appointment record not found or access denied." 
            });
        }

        // 5. Fetch & Map Real Payment Details
        let rzpDetails = null;
        try {
            if (rzpSignature) {
                rzpDetails = await fetchAndMapRazorpayPayment(rzpPaymentId, rzpSignature);
            }
        } catch (fetchErr) {}

        if (!rzpDetails) {
            rzpDetails = {
                razorpayPaymentId: rzpPaymentId,
                razorpayOrderId: rzpOrderId || "",
                razorpaySignature: rzpSignature || "",
                method: 'Online',
                amount: appointment.totalAmount || 0,
                status: 'captured',
                paidAt: new Date()
            };
        }

        appointment.paymentStatus = 'Paid';
        appointment.paymentMethod = 'Online';
        appointment.transactionId = rzpPaymentId;
        appointment.paymentDetails = rzpDetails;
        
        if (appointment.status === 'Pending') {
            appointment.status = 'Confirmed';
        }

        await appointment.save();

        // 6. Deduct Subscription Benefit count if applied
        if (appointment.pricingBreakdown?.originalBaseFee > 0 && appointment.pricingBreakdown?.baseFee === 0) {
            await deductBenefitCount(appointment.userId, 'freeDoctorAppointmentsCount');
        }

        // 7. Alert Doctor via Push Notification
        if (appointment.doctorId) {
            try {
                await sendPushNotification(
                    appointment.doctorId,
                    'doctor',
                    "New Appointment Booked & Paid!",
                    `Appointment #${appointment.bookingId} is confirmed for ${appointment.appointmentTime}.`,
                    { appointmentId: appointment._id.toString(), type: 'new_doctor_appointment' }
                );
            } catch (e) {}
        }

        res.status(200).json({
            success: true,
            message: "Doctor appointment payment successfully verified & confirmed!",
            data: {
                _id: appointment._id,
                bookingId: appointment.bookingId,
                status: appointment.status,
                paymentStatus: appointment.paymentStatus,
                paymentMethod: appointment.paymentMethod,
                amountPaid: appointment.totalAmount || 0
            }
        });

    } catch (error) {
        console.error("Verify Doctor Payment Error:", error);
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

// 5. GET USER APPOINTMENTS (Figma: My Bookings with Pagination)
// endpoint: GET /user/doctors/my-appointments?page=1&limit=10&status=Confirmed
const getUserAppointments = async (req, res) => {
    try {
        const { status, page = 1, limit = 10 } = req.query; 
        const query = { 
            userId: req.user.id, 
            bookingType: 'Appointment' 
        };        
        if (status) query.status = status; 

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 10);
        const skip = (pageNum - 1) * limitNum;
        
        const globalConfig = await DocRescheduleLimit.findOne();
        const maxLimit = globalConfig ? globalConfig.maxLimit : 2;

        const total = await Appointment.countDocuments(query);

        const appointments = await Appointment.find(query)
            .populate('doctorId', 'name speciality profileImage profileStatus role')
            .sort({ appointmentDate: -1 })
            .skip(skip)
            .limit(limitNum);

        const formattedAppointments = appointments.map(app => {
            const appObj = app.toObject ? app.toObject() : { ...app };
            const currentRescheduleCount = appObj.rescheduleCount || 0;
            const currentCancelCount = appObj.cancellationCount || 0;

            appObj.remainingReschedules = Math.max(0, maxLimit - currentRescheduleCount);
            appObj.remainingCancellations = Math.max(0, maxLimit - currentCancelCount);
            return appObj;
        });

        res.json({ 
            success: true, 
            total,
            currentPage: pageNum,
            totalPages: Math.ceil(total / limitNum),
            count: formattedAppointments.length, 
            maxRescheduleLimit: maxLimit, 
            data: formattedAppointments 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 6. CANCEL APPOINTMENT
const userCancelAppointment = async (req, res) => {
    try {
        const { reason, isPermanent = false } = req.body; // isPermanent: true (Refund) | false (Reschedule-Ready)
        const appointment = await Appointment.findOne({ _id: req.params.id, userId: req.user.id });

        if (!appointment) return res.status(404).json({ success: false, message: "Appointment not found." });
        
        const terminalStates = ['In-Progress', 'Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'No-Show'];
        if (terminalStates.includes(appointment.status)) {
            return res.status(400).json({ success: false, message: "Cannot cancel appointment in its current state." });
        }

        const globalConfig = await DocRescheduleLimit.findOne();
        const maxLimit = globalConfig ? globalConfig.maxLimit : 2;

        const currentCancelCount = appointment.cancellationCount || 0;
        const currentRescheduleCount = appointment.rescheduleCount || 0; 

        if (currentRescheduleCount >= maxLimit) {
            return res.status(400).json({
                success: false,
                message: `Cancellation Blocked: Reschedule limit (${maxLimit}) has expired.`
            });
        }

        if (currentCancelCount >= maxLimit) {
            return res.status(400).json({
                success: false,
                message: `Cancellation Blocked: Maximum cancellations (${maxLimit}) reached.`
            });
        }

        let penalty = 0;
        let refund = 0;

        // =========================================================================
        // CASE A: PERMANENT CANCELLATION (Calculates dynamic fee & locks refund)
        // =========================================================================
        if (isPermanent === true || isPermanent === "true") {
            const policyResult = await processCancellationRefund(appointment, 'Doctor');
            penalty = policyResult.cancellationFee;
            refund = policyResult.refundAmount;
            
            appointment.paymentStatus = 'Refund-Initiated';
            appointment.status = 'Cancelled-By-User';

            // Subscription benefit refund check (only if cancellation fee is 0)
            if (appointment.subscriptionDetails?.isSubscriptionApplied && appointment.pricingBreakdown?.baseFee === 0) {
                if (penalty === 0) {
                    await refundBenefitCount(appointment.userId, 'freeDoctorAppointmentsCount');
                }
            }
        } 
        // =========================================================================
        // CASE B: NORMAL CANCELLATION (Bypasses refund, slot is freed up for reschedule)
        // =========================================================================
        else {
            appointment.paymentStatus = 'Paid'; // Keep payment valid
            appointment.status = 'Cancelled-By-User'; // Marked so the user can click Reschedule
        }

        appointment.cancellationCount = currentCancelCount + 1;
        appointment.cancellationDetails = {
            cancelledBy: req.user.id,
            reason: reason || "Cancelled by user",
            cancelledAt: new Date(),
            isPermanent: isPermanent === true || isPermanent === "true",
            refundAmountCalculated: refund,
            penaltyApplied: penalty
        };
        
        appointment.pricingBreakdown.cancellationFeeApplied = penalty;

        await appointment.save();

        res.json({ 
            success: true, 
            message: isPermanent 
                ? `Appointment cancelled permanently. Refund of ₹${refund} initiated (Penalty: ₹${penalty}).`
                : "Appointment cancelled successfully. You can reschedule this appointment anytime.",
            cancellationLeft: maxLimit - appointment.cancellationCount,
            data: {
                cancellationFee: penalty,
                refundAmount: refund,
                appointment
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// RESCHEDULE
const rescheduleAppointment = async (req, res) => {
    try {
        console.log("\n🔄 [INCOMING RESCHEDULE REQUEST]:", JSON.stringify(req.body, null, 2));

        // 🚨 1. Flexible Key Mapping (Frontend kisi bhi key name se data bheje, match ho jayega)
        const appointmentId = req.body.appointmentId || req.body.id || req.body.bookingId;
        const newDate = req.body.newDate || req.body.appointmentDate || req.body.date;
        const newTimeSlot = req.body.newTimeSlot || req.body.timeSlot || req.body.appointmentTime;

        if (!appointmentId || !newDate || !newTimeSlot) {
            console.log("❌ 400 REJECTED: Missing required fields ->", { appointmentId, newDate, newTimeSlot });
            return res.status(400).json({ 
                success: false, 
                message: "Appointment ID, New Date, and New TimeSlot are mandatory." 
            });
        }

        // 2. Fetch User Appointment
        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const query = {
            $or: [
                { _id: isObjectId ? new mongoose.Types.ObjectId(appointmentId) : new mongoose.Types.ObjectId() },
                { bookingId: String(appointmentId).trim() }
            ],
            userId: req.user.id
        };

        const appt = await Appointment.findOne(query);
        if (!appt) {
            console.log("❌ 404 REJECTED: Appointment not found for user:", req.user.id);
            return res.status(404).json({ success: false, message: "Appointment record not found." });
        }

        // 3. Blocked Status Check
        const blockedStates = ['Completed', 'In-Progress', 'No-Show'];
        if (blockedStates.includes(appt.status)) {
            console.log(`❌ 400 REJECTED: Appointment is already in '${appt.status}' state.`);
            return res.status(400).json({ 
                success: false, 
                message: `Reschedule Blocked: Consultation is already in '${appt.status}' state.` 
            });
        }

        // 4. Global Limit Check (Max 2 Reschedules)
        const globalConfig = await DocRescheduleLimit.findOne();
        const maxLimit = globalConfig ? globalConfig.maxLimit : 2;
        const currentRescheduleCount = appt.rescheduleCount || 0;

        if (currentRescheduleCount >= maxLimit) {
            console.log(`❌ 400 REJECTED: Max limit reached (${currentRescheduleCount}/${maxLimit})`);
            return res.status(400).json({
                success: false,
                message: `Reschedule failed: Maximum reschedule limit (${maxLimit} times) reached for this appointment.`
            });
        }

        // 5. Check if New Slot is Already Booked (Safe Date Range Boundary)
        const queryStart = moment(newDate).startOf('day').toDate();
        const queryEnd = moment(newDate).endOf('day').toDate();

        const isBooked = await Appointment.findOne({
            _id: { $ne: appt._id },
            doctorId: appt.doctorId,
            appointmentDate: { $gte: queryStart, $lte: queryEnd },
            appointmentTime: newTimeSlot,
            status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'No-Show'] }
        });

        if (isBooked) {
            console.log(`❌ 400 REJECTED: Slot '${newTimeSlot}' on '${newDate}' is already booked.`);
            return res.status(400).json({ 
                success: false, 
                message: `The selected time slot (${newTimeSlot}) is already booked. Please select another slot.` 
            });
        }

        // 6. Update Appointment
        appt.appointmentDate = new Date(newDate);
        appt.appointmentTime = newTimeSlot;
        appt.rescheduleCount = currentRescheduleCount + 1;
        appt.status = 'Confirmed'; 

        await appt.save();

        console.log(`✅ APPOINTMENT RESCHEDULED SUCCESSFULLY (Count: ${appt.rescheduleCount}/${maxLimit})`);

        res.json({ 
            success: true, 
            message: "Appointment rescheduled successfully", 
            remainingReschedules: Math.max(0, maxLimit - appt.rescheduleCount),
            data: appt 
        });

    } catch (error) {
        console.error("Reschedule Appointment Error:", error);
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

// @desc    Get All Prescriptions for Patient (Deeply Populates Hospital & Doctor for OPD & Clinic visits)
// @route   GET /user/doctors/prescriptions
// @access  Private (User)
const getMyPrescriptions = async (req, res) => {
    try {
        const userId = req.user.id;
        const { search, page = 1, limit = 20 } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 20);
        const skip = (pageNum - 1) * limitNum;

        const total = await Prescription.countDocuments({ userId });

        const prescriptions = await Prescription.find({ userId })
            .populate('doctorId', 'name speciality profileImage qualification')
            .populate({
                path: 'appointmentId',
                select: 'bookingId bookingType appointmentDate appointmentTime tokenNumber hospitalId',
                populate: {
                    path: 'hospitalId',
                    select: 'name city address hospitalImage'
                }
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        const formatted = prescriptions.map(rx => {
            const appt = rx.appointmentId;
            const isHospitalOpd = appt?.bookingType === 'OPD' && appt?.hospitalId;

            return {
                ...rx,
                isHospitalOpd: !!isHospitalOpd,
                hospitalName: isHospitalOpd ? appt.hospitalId.name : null,
                hospitalCity: isHospitalOpd ? appt.hospitalId.city : null,
                tokenNumber: appt?.tokenNumber || null,
                formattedDate: moment(rx.createdAt).format('DD MMM YYYY')
            };
        });

        res.status(200).json({
            success: true,
            count: formatted.length,
            totalRecords: total,
            totalPages: Math.ceil(total / limitNum),
            currentPage: pageNum,
            data: formatted
        });

    } catch (error) {
        console.error("Get My Prescriptions Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get Available Slots from Cart View (Now with full real-time occupancy & prescription holds checking)
// @route   GET /user/cart/available-slots
// @access  Private (User)
const getAvailableSlots = async (req, res) => {
    try {
        const { vendorId, date } = req.query; 

        if (!vendorId || !date) {
            return res.status(400).json({ success: false, message: "vendorId and date are required." });
        }

        const config = await Availability.findOne({ vendorId }).lean();
        if (!config) return res.status(404).json({ success: false, message: "Slots not configured" });

        const dayName = moment(date).format('dddd');
        if (Array.isArray(config.offDays) && config.offDays.includes(dayName)) {
            return res.status(200).json({ success: true, isClosed: true, slots: [] });
        }

        const allSlots = generateTimeSlots(config);
        const startOfDay = moment(date).startOf('day').toDate();
        const endOfDay = moment(date).endOf('day').toDate();

        // 1. Check bookings & prescription holds
        const [bookedOrders, activePrescriptions] = await Promise.all([
            LabBooking.find({
                labId: vendorId,
                appointmentDate: { $gte: startOfDay, $lte: endOfDay },
                status: { $nin: ['Cancelled', 'No-Show'] }
            }).select('appointmentTime').lean(),

            LabPrescriptionRequest.find({
                labId: vendorId,
                appointmentDate: { $gte: startOfDay, $lte: endOfDay },
                status: { $in: ['Pending Review', 'Reviewing', 'Bill Generated', 'Pending Payment'] }
            }).select('appointmentTime').lean()
        ]);

        const normalize = (t) => {
            if (!t) return "";
            let c = String(t).trim().split('-')[0].trim();
            const m = moment(c, ["HH:mm", "H:mm", "hh:mm A", "h:mm A"]);
            return m.isValid() ? m.format("HH:mm") : c;
        };

        const usageMap = {};
        bookedOrders.forEach(b => {
            const k = normalize(b.appointmentTime);
            if (k) usageMap[k] = (usageMap[k] || 0) + 1;
        });
        activePrescriptions.forEach(p => {
            const k = normalize(p.appointmentTime);
            if (k) usageMap[k] = (usageMap[k] || 0) + 1;
        });

        const maxCapacity = Number(config.maxClientsPerSlot || 0);

        const mappedSlots = allSlots.map(s => {
            const slotK = normalize(s.time);
            const isFull = maxCapacity > 0 && (usageMap[slotK] || 0) >= maxCapacity;
            return {
                ...s,
                isAvailable: !isFull,
                isFull,
                currentBookings: usageMap[slotK] || 0
            };
        });

        res.status(200).json({ success: true, isClosed: false, slots: mappedSlots });
    } catch (error) { 
        console.error("Cart Get Available Slots Error:", error);
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