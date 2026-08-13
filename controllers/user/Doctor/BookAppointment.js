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

        // 🚨 CRITICAL CHECK: Block access if doctor is not found or is marked inactive by Admin
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
                    averageRating: averageRating,   
                    totalReviews: reviews.length,  
                    experience: `${doctor.experienceYears}+ years`,
                    workingHours: workingHoursDisplay,
                    helpWith: doctor.treatedConditions || ["Fever", "Cough", "Headache"],
                    competencies: doctor.competencies || ["MD Degree", "Emergency Care"],
                    isOnline: doctor.isOnline ?? true // Sends online status to UI
                },
                activeServices: [
                    { type: 'Clinic Visit', fee: doctor.fees.clinic, active: doctor.consultationStatus.clinic },
                    { type: 'Video Consult', fee: doctor.fees.online, active: doctor.consultationStatus.online },
                    { type: 'Home Visit', fee: doctor.fees.home, active: doctor.consultationStatus.home }
                ],
                recentReviews 
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
// const getCheckoutSummary = async (req, res) => {
//     try {
//         const { 
//             doctorId, consultationType, couponCode, 
//             distance = 0, timeSlot, appointmentDate, 
//             specialServices = [], patients = [], address = null 
//         } = req.body;

//         const doctor = await Doctor.findById(doctorId);
//         if (!doctor) return res.status(404).json({ message: "Doctor not found" });

//         const typeMap = { 'Video Consult': 'online', 'Clinic Visit': 'clinic', 'Home Visit': 'home' };
//         let baseFee = doctor.fees[typeMap[consultationType]] || 0;

//         // 🚨 SUBSCRIPTION CHECK: Free Doctor Consultations check karein
//         const docBenefit = await checkAndApplyBenefit(req.user.id, 'freeDoctorAppointmentsCount', baseFee);
//         baseFee = docBenefit.amount; // Benefit active hone par baseFee 0 ho jayegi

//         let visitCharge = 0;
//         if (consultationType === 'Home Visit') {
//             if (!address) return res.status(400).json({ message: "Address required for Home Visit" });

//             const chargeConfig = await DeliveryCharge.findOne({ vendorId: doctorId, vendorType: 'Doctor' });
            
//             if (chargeConfig) {
//                 visitCharge = chargeConfig.fixedPrice; 
//                 if (distance > chargeConfig.fixedDistance) {
//                     visitCharge += (distance - chargeConfig.fixedDistance) * chargeConfig.pricePerKM;
//                 }
//             } else {
//                 visitCharge = 100; 
//             }
//         }

//         let premiumFee = 0;
//         const avail = await Availability.findOne({ vendorId: doctorId, vendorType: 'Doctor' });
//         const slot = avail?.premiumSlots.find(s => s.time === timeSlot);
//         if (slot) premiumFee = slot.extraFee;

//         const servicesTotal = specialServices.reduce((sum, s) => sum + (s.price || 0), 0);
//         let subtotal = baseFee + visitCharge + premiumFee + servicesTotal;

//         let discount = 0;
//         if (couponCode) {
//             const coupon = await Coupon.findOne({ couponName: couponCode.toUpperCase(), isActive: true });
//             if (coupon && subtotal >= coupon.minOrderAmount) {
//                 discount = Math.min((subtotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
//             }
//         }

//         res.json({
//             success: true,
//             data: {
//                 baseFee,
//                 visitCharge, 
//                 premiumFee,
//                 servicesTotal,
//                 discount,
//                 subtotal,
//                 totalPayable: subtotal - discount,
//                 patients,
//                 address: consultationType === 'Home Visit' ? address : null
//             }
//         });
//     } catch (error) { res.status(500).json({ message: error.message }); }
// };

// for condtional subcription plan check, we will use the middleware requireConditionPlan in the routes for specialized disease care bookings. This middleware will ensure that only users with an active subscription for the required disease care plan can access the booking endpoints.
// --- GET CHECKOUT SUMMARY (Updated with COD Check) ---
const getCheckoutSummary = async (req, res) => {
    try {
        let body = { ...req.body };

        // 🚨 SAFE MULTIPART PARSER
        if (typeof body.patients === 'string') {
            try { body.patients = JSON.parse(body.patients); } catch (e) { body.patients = []; }
        }
        if (typeof body.address === 'string') {
            try { body.address = JSON.parse(body.address); } catch (e) { body.address = null; }
        }
        if (typeof body.specialServices === 'string') {
            try { body.specialServices = JSON.parse(body.specialServices); } catch (e) { body.specialServices = []; }
        }

        const { 
            doctorId, consultationType, couponCode, 
            distance = 0, timeSlot, appointmentDate, 
            specialServices = [], patients = [], address = null 
        } = body;

        const doctor = await Doctor.findById(doctorId);
        if (!doctor) return res.status(404).json({ message: "Doctor not found" });

        // 🚨 SECURITY LOCK: Fetch dynamic COD toggle state from admin panel
        const isCodAllowed = await isCodEnabled('Doctor');

        // FAMILY MEMBERS VERIFICATION LOGIC
        const user = await User.findById(req.user.id).select('familyMember');
        if (!user) return res.status(404).json({ message: "User account not found" });

        if (patients && Array.isArray(patients)) {
            for (const patient of patients) {
                const pName = patient.patientName || patient.name || "Self";
                const isSelf = patient.relation === 'Self' || pName.toLowerCase() === 'self';
                
                if (!isSelf) {
                    const isRegisteredMember = user.familyMember.some(member => 
                        member.memberName && member.memberName.toLowerCase() === pName.toLowerCase()
                    );

                    if (!isRegisteredMember) {
                        return res.status(400).json({
                            success: false,
                            message: `Access Blocked: Patient '${pName}' is not registered under your family profile.`
                        });
                    }
                }
            }
        }

        const typeMap = { 'Video Consult': 'online', 'Clinic Visit': 'clinic', 'Home Visit': 'home' };
        let baseFee = doctor.fees[typeMap[consultationType]] || 0;

        let originalBaseFee = baseFee; 
        let isSubscriptionApplied = false;
        let planName = "";
        let userSubscriptionId = null;

        // SUBSCRIPTION CHECK
        const { checkAndApplyBenefit } = require('../../../utils/subscriptionBenefitHelper');
        const docBenefit = await checkAndApplyBenefit(req.user.id, 'freeDoctorAppointmentsCount', baseFee);
        
        if (docBenefit.isApplied) {
            baseFee = 0; 
            isSubscriptionApplied = true;

            const UserSubscription = require('../../../models/UserSubscription');
            const activeSub = await UserSubscription.findOne({
                userId: req.user.id,
                status: 'Active',
                endDate: { $gt: new Date() }
            }).populate('planId', 'name');

            if (activeSub) {
                planName = activeSub.planId?.name || "Premium Care Plan";
                userSubscriptionId = activeSub._id;
            }
        }

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
                originalBaseFee, 
                visitCharge, 
                premiumFee,
                servicesTotal,
                discount,
                subtotal,
                totalPayable: subtotal - discount,
                patients,
                address: consultationType === 'Home Visit' ? address : null,
                isCodAvailable: isCodAllowed, // 👈 Dynamic indicator added
                subscriptionDetails: {
                    isSubscriptionApplied, 
                    userSubscriptionId,
                    planName
                }
            }
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// --- C. BOOK APPOINTMENT (INTEGRATED WITH RAZORPAY ORDER CREATION) ---
// Mapped only for Independent Doctors (Role check added) [1]
// --- C. BOOK APPOINTMENT (INTEGRATED WITH RAZORPAY & COD LOCKS) ---
const bookAppointment = async (req, res) => {
    try {
        console.log("Incoming Appointment Booking Request:", req.body);

        let body = { ...req.body };

        // 🚨 SAFE MULTIPART PARSER
        if (typeof body.patients === 'string') {
            try { body.patients = JSON.parse(body.patients); } catch (e) { body.patients = []; }
        }
        if (typeof body.address === 'string') {
            try { body.address = JSON.parse(body.address); } catch (e) { body.address = null; }
        }
        if (typeof body.pricingBreakdown === 'string') {
            try { body.pricingBreakdown = JSON.parse(body.pricingBreakdown); } catch (e) { body.pricingBreakdown = {}; }
        }

        const { 
            doctorId, 
            appointmentDate, 
            timeSlot,          
            consultationType, 
            patients, 
            address,
            pricingBreakdown,  
            totalAmount        
        } = body;

        const appointmentTime = timeSlot; 
        const pricingData = pricingBreakdown; 

        // 1. Basic Validations
        if (!doctorId || !appointmentDate || !appointmentTime) {
            return res.status(400).json({ 
                success: false, 
                message: "Required fields (doctorId, appointmentDate, timeSlot) are missing." 
            });
        }

        if (!pricingData || typeof totalAmount === 'undefined') {
            return res.status(400).json({ 
                success: false, 
                message: "Pricing details or totalAmount missing." 
            });
        }

        // Validate Payment Method Enum
        const allowedPaymentMethods = ['UPI', 'COD', 'Card', 'Netbanking', 'Wallet'];
        const activePaymentMethod = body.paymentMethod || "UPI";
        
        if (!allowedPaymentMethods.includes(activePaymentMethod)) {
            return res.status(400).json({
                success: false,
                message: `Invalid paymentMethod. Allowed values are: ${allowedPaymentMethods.join(', ')}`
            });
        }

        // 🚨 STRICTOR COD VALIDATION
        if (activePaymentMethod === 'COD') {
            const isCodAllowed = await isCodEnabled('Doctor');
            if (!isCodAllowed) {
                return res.status(400).json({
                    success: false,
                    message: "Cash on Delivery is currently disabled for doctor appointments. Please pay online to complete your booking."
                });
            }
        }

        // 2. Strict Independent Doctor Role Validation
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

        if (doctor.isOnline === false) {
            return res.status(400).json({
                success: false,
                message: "Booking Blocked: Doctor is currently offline and not accepting appointments."
            });
        }

        const isBooked = await Appointment.findOne({ 
            doctorId, 
            appointmentDate: new Date(appointmentDate), 
            appointmentTime, 
            status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor'] } 
        });

        if (isBooked) {
            return res.status(400).json({ success: false, message: "This slot is already booked." });
        }

        // Subscription variables
        const typeMap = { 'Video Consult': 'online', 'Clinic Visit': 'clinic', 'Home Visit': 'home' };
        const rawDoctorFee = doctor.fees[typeMap[consultationType]] || 0;

        let originalBaseFee = rawDoctorFee;
        let isSubscriptionApplied = false;
        let planName = "";
        let userSubscriptionId = null;

        const { checkAndApplyBenefit } = require('../../../utils/subscriptionBenefitHelper');
        const docBenefit = await checkAndApplyBenefit(req.user.id, 'freeDoctorAppointmentsCount', rawDoctorFee);
        
        if (docBenefit.isApplied) {
            isSubscriptionApplied = true;

            const UserSubscription = require('../../../models/UserSubscription');
            const activeSub = await UserSubscription.findOne({
                userId: req.user.id,
                status: 'Active',
                endDate: { $gt: new Date() }
            }).populate('planId', 'name');

            if (activeSub) {
                planName = activeSub.planId?.name || "Premium Care Plan";
                userSubscriptionId = activeSub._id;
            }
        }

        const tempBookingId = `HK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const finalPayable = Number(totalAmount);

        // =========================================================================
        // CASE A: FREE BOOKING & COD BYPASS
        // =========================================================================
        if (finalPayable === 0 || activePaymentMethod === 'COD') {
            const appointment = await Appointment.create({
                userId: req.user.id,
                doctorId,
                patients: patients,
                address: consultationType === 'Home Visit' ? address : undefined,
                appointmentDate: new Date(appointmentDate),
                appointmentTime, 
                consultationType,
                paymentMethod: activePaymentMethod,
                
                pricingBreakdown: {
                    baseFee: Number(pricingData.baseFee || 0),
                    originalBaseFee: Number(originalBaseFee), 
                    visitCharges: Number(pricingData.visitCharges || 0),
                    extraCharges: Number(pricingData.extraCharges || 0),
                    discountAmount: Number(pricingData.discountAmount || 0),
                    subtotal: Number(pricingData.subtotal || 0)
                },
                
                totalAmount: finalPayable,
                bookingId: tempBookingId,
                status: 'Confirmed', // Confirmed instantly on submit
                paymentStatus: 'Pending',
                transactionId: `FREE-${tempBookingId}`,
                'tracking.otp': Math.floor(1000 + Math.random() * 9000).toString(),

                subscriptionDetails: {
                    isSubscriptionApplied: isSubscriptionApplied,
                    userSubscriptionId: userSubscriptionId,
                    planName: planName
                }
            });

            if (isSubscriptionApplied) {
                const { deductBenefitCount } = require('../../../utils/subscriptionBenefitHelper');
                await deductBenefitCount(req.user.id, 'freeDoctorAppointmentsCount');
            }

            await notifyAdminsAndVendor(
                doctorId,
                'doctor',
                "New Appointment Confirmed!",
                `Appointment scheduled on ${moment(appointmentDate).format('YYYY-MM-DD')} at ${appointmentTime}.`,
                { appointmentId: appointment._id.toString(), type: 'new_appointment' }
            );

            return res.status(201).json({
                success: true,
                message: "Appointment successfully confirmed!",
                data: appointment
            });
        }

        // =========================================================================
        // CASE B: PAID ONLINE BOOKING
        // =========================================================================
        const rzpOrder = await createRazorpayOrder(finalPayable, `receipt_${tempBookingId}`);

        const appointment = await Appointment.create({
            userId: req.user.id,
            doctorId,
            patients: patients,
            address: consultationType === 'Home Visit' ? address : undefined,
            appointmentDate: new Date(appointmentDate),
            appointmentTime, 
            consultationType,
            paymentMethod: activePaymentMethod,
            
            pricingBreakdown: {
                baseFee: Number(pricingData.baseFee || 0),
                originalBaseFee: Number(originalBaseFee), 
                visitCharges: Number(pricingData.visitCharges || 0),
                extraCharges: Number(pricingData.extraCharges || 0),
                discountAmount: Number(pricingData.discountAmount || 0),
                subtotal: Number(pricingData.subtotal || finalPayable)
            },
            
            totalAmount: finalPayable,
            bookingId: tempBookingId,
            status: 'Pending', 
            paymentStatus: 'Pending',
            transactionId: rzpOrder.id, 
            'tracking.otp': Math.floor(1000 + Math.random() * 9000).toString(),

            subscriptionDetails: {
                isSubscriptionApplied: isSubscriptionApplied,
                userSubscriptionId: userSubscriptionId,
                planName: planName
            }
        });

        res.status(201).json({ 
            success: true, 
            message: "Razorpay order created. Complete payment to confirm.",
            key_id: process.env.RAZORPAY_KEY_ID, 
            amount: rzpOrder.amount, 
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

        // 🚨 LOGICAL RESOLVE: Only deduct subscription count if the consultation was free via plan (baseFee is 0)
        if (appointment.pricingBreakdown?.baseFee === 0) {
            const { deductBenefitCount } = require('../../../utils/subscriptionBenefitHelper');
            await deductBenefitCount(appointment.userId, 'freeDoctorAppointmentsCount');
        }

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

        // 🚀 SYNC FIX: Map through appointments and dynamically inject remaining counts for frontend rendering
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