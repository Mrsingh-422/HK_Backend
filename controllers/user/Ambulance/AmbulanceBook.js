const Ambulance = require('../../../models/Ambulance');
const Booking = require('../../../models/AmbulanceBooking');
const Hospital = require('../../../models/Hospital');
const User = require('../../../models/User');
const Coupon = require('../../../models/Coupon');
const Review = require('../../../models/Review');
const crypto = require('crypto');
const Wallet = require('../../../models/Wallet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const moment = require('moment');
const { getDistance } = require('../../../utils/helpers');
const { sendPushNotification,notifyAdminsAndVendor } = require('../../../utils/notification');
const { createRazorpayOrder, verifyRazorpaySignature,fetchAndMapRazorpayPayment } = require('../../../utils/razorpay'); // 👈 Razorpay Helpers Imported
const { checkAndApplyBenefit, deductBenefitCount,refundBenefitCount } = require('../../../utils/subscriptionBenefitHelper');
const { processCancellationRefund } = require('../../../utils/policyHelper');
const { isCodEnabled } = require('../../../utils/policyHelper');
const { verifyFirebasePhoneToken } = require('../../../utils/firebaseAuthHelper');
const UserSubscription = require('../../../models/UserSubscription');
const Appointment = require('../../../models/Appointment');

const generateToken = (id, role = 'user') => {
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

const generateCaseRef = (type) => {
    const prefix = type === 'Accident emergency' ? 'ACC' : (type === 'Referral Ambulance' ? 'REF' : 'MED');
    const randomHex = crypto.randomBytes(2).toString('hex').toUpperCase();
    const timeSlice = Date.now().toString().slice(-4);
    return `HK-${new Date().getFullYear()}-${prefix}-${timeSlice}${randomHex}`;
};


// --- 1. GET MASTER DATA (Enums for UI Dropdowns) ---
const getAmbulanceMasterData = async (req, res) => {
    try {
        const vehicleTypes = Ambulance.schema.path('vehicleType').enumValues;
        const triageOptions = Booking.schema.path('triageLevel').enumValues;
        const serviceTypes = Booking.schema.path('serviceType').enumValues;

        res.json({
            success: true,
            data: {
                vehicleTypes, // ['Van', 'Mini Van', 'Advance Life Support', 'ICU Ambulance']
                triageOptions, 
                serviceTypes
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. FIND NEARBY HOSPITALS (POST with Distance) ---
// Figma Screen 42
const getNearbyHospitals = async (req, res) => {
    try {
        const { lat, lng } = req.body;
        const hospitals = await Hospital.find({ profileStatus: 'Approved' })
            .select('name address hospitalImage location');

        const data = await Promise.all(hospitals.map(async (h) => {
            const distance = await getDistance(lat, lng, h.location.lat, h.location.lng);
            return {
                ...h._doc,
                distance: `${distance} km`,
                rawDistance: distance,
                tags: ['NABL Accredited', 'JCI Certified'], 
                rating: 4.4
            };
        }));

        data.sort((a, b) => a.rawDistance - b.rawDistance);
        res.json({ success: true, data });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// =========================================================================
// 📞 REUSABLE HELPER: GOVERNMENT EMERGENCY HELPLINES DICTIONARY
// =========================================================================
const getEmergencyHelplinesData = () => ({
    govtAmbulance: {
        number: "108",
        title: "Government Free Emergency Ambulance (108)",
        description: "Direct line to State Emergency Medical Response"
    },
    nationalEmergency: {
        number: "112",
        title: "National Emergency Control Room (112)",
        description: "All-in-One Police, Fire & Medical Helpline"
    },
    policeControlRoom: {
        number: "100",
        title: "Police Control Room (100)",
        description: "Highway patrol & traffic emergency unit"
    },
    healthKangarooHelpline: {
        number: "+919876543210",
        title: "Health Kangaroo 24/7 Support Desk",
        description: "Fleet Management & Escalation Control"
    }
});

// =========================================================================
// 1. GET NEAREST AMBULANCES (With 0-Availability Helpline Fallback)
// =========================================================================
const getNearestAmbulances = async (req, res) => {
    try {
        const { lat, lng, serviceType, vehicleType } = req.body; 

        let query = { 
            isActive: true, 
            profileStatus: 'Approved',
            isOnline: true,
            availableForEmergency: true
        };
        
        if (vehicleType && vehicleType !== 'All') {
            query.vehicleType = vehicleType;
        }

        // Exclude busy ambulances
        const busyBookings = await Booking.find({
            status: { $in: ['Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] }
        }).select('ambulanceId').lean();

        const busyIds = busyBookings.filter(b => b.ambulanceId).map(b => b.ambulanceId.toString());
        if (busyIds.length > 0) {
            query._id = { $nin: busyIds };
        }

        const ambulances = await Ambulance.find(query).lean();

        // 🚨 AGAR 1 BHI AMBULANCE NAHI MILI
        if (!ambulances || ambulances.length === 0) {
            return res.json({
                success: true,
                isServiceAvailable: false,
                count: 0,
                message: "No ambulances are currently available or online in your area.",
                emergencyHelplines: getEmergencyHelplinesData(),
                data: []
            });
        }

        const data = await Promise.all(ambulances.map(async (amb) => {
            let distance = 0;
            if (lat && lng && amb.location?.lat && amb.location?.lng) {
                distance = await getDistance(Number(lat), Number(lng), Number(amb.location.lat), Number(amb.location.lng));
            }
            
            const reviews = await Review.find({ targetId: amb._id, targetType: 'Ambulance' }).select('rating').lean();
            let averageRating = amb.averageRating > 0 ? amb.averageRating : 5.0; 
            if (reviews.length > 0) {
                const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
                averageRating = Number((totalRating / reviews.length).toFixed(1)); 
            }

            let displayPrice = amb.pricing?.fixedPrice || 2000;
            let isFree = (serviceType === 'Accident emergency');
            if (serviceType === 'Medical Ambulance' && amb.freeServices?.emergency) { displayPrice = 0; isFree = true; }
            if (serviceType === 'Referral Ambulance' && amb.freeServices?.referral) { displayPrice = 0; isFree = true; }

            return {
                ...amb,
                distance: `${distance} km`,
                rawDistance: distance,
                displayPrice: isFree ? 0 : displayPrice,
                isFreeCase: isFree,
                eta: `${Math.max(1, Math.round(distance * 3))} mins`,
                rating: averageRating,
                totalReviews: reviews.length,
                isOnline: true,
                availableForEmergency: true
            };
        }));

        data.sort((a, b) => a.rawDistance - b.rawDistance);

        res.json({
            success: true,
            isServiceAvailable: true,
            count: data.length,
            data
        });

    } catch (error) { 
        console.error("getNearestAmbulances Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};
const getAmbulanceDetails = async (req, res) => {
    try {
        const { id } = req.params;

        const ambulance = await Ambulance.findById(id)
            .populate('hospitalId', 'name address city state hospitalImage location')
            .select('+password');

        // 🚨 CRITICAL CHECK: Block access if ambulance is inactive by Admin
        if (!ambulance || ambulance.isActive === false) {
            return res.status(404).json({ success: false, message: "Ambulance profile is inactive or not found." });
        }

        const reviews = await Review.find({ 
            targetId: id, 
            targetType: 'Ambulance' 
        }).select('rating').lean();

        let averageRating = 4.8; 
        if (reviews.length > 0) {
            const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
            averageRating = Number((totalRating / reviews.length).toFixed(1)); 
        }

        const recentReviews = await Review.find({ targetId: id, targetType: 'Ambulance' })
            .select('userName rating comment createdAt')
            .sort({ createdAt: -1 })
            .limit(3)
            .lean();

        const data = {
            _id: ambulance._id,
            driverInfo: {
                name: ambulance.driverInfo?.fullName || ambulance.name,
                phone: ambulance.phone,
                email: ambulance.email,
                experience: ambulance.experienceYears || "N/A",
                bloodGroup: ambulance.bloodGroup,
                department: ambulance.driverInfo?.department,
                rating: averageRating, 
                totalReviews: reviews.length, 
                tripsCount: reviews.length > 0 ? `${reviews.length * 3 + 120}+` : "1,240+" 
            },
            vehicle: {
                vehicleNumber: ambulance.vehicleNumber || "Not Assigned",
                vehicleType: ambulance.vehicleType, 
                serviceRadius: ambulance.serviceRadius,
                isAvailable: ambulance.availableForEmergency,
                features: ambulance.vehicleType === 'Advance Life Support' 
                    ? ["Ventilator", "Paramedic", "Oxygen", "Monitor"] 
                    : ["Oxygen Support", "First Aid Kit", "Stretcher"]
            },
            pricing: {
                basePrice: ambulance.pricing?.fixedPrice || 0,
                baseDistance: ambulance.pricing?.baseDistance || 0,
                extraKMPrice: ambulance.pricing?.pricePerKM || 0,
                supportStaff: {
                    nurse: {
                        isAvailable: ambulance.supportStaff?.nurse?.available || false,
                        fee: ambulance.supportStaff?.nurse?.price || 0
                    },
                    doctor: {
                        isAvailable: ambulance.supportStaff?.doctor?.available || false,
                        fee: ambulance.supportStaff?.doctor?.price || 0
                    }
                },
                freeServices: {
                    isAccidentalFree: ambulance.freeServices?.accidental || true, 
                    isEmergencyFree: ambulance.freeServices?.emergency || false,
                    isReferralFree: ambulance.freeServices?.referral || false
                }
            },
            location: ambulance.location,
            address: ambulance.address,
            associatedHospital: ambulance.hospitalId ? {
                id: ambulance.hospitalId._id,
                name: ambulance.hospitalId.name,
                address: ambulance.hospitalId.address,
                image: ambulance.hospitalId.hospitalImage?.[0] || null
            } : null,
            documents: {
                licenseVerified: !!ambulance.documents?.drivingLicenseFile,
                rcVerified: !!ambulance.documents?.rcFile,
                insuranceValid: !!ambulance.documents?.insuranceFile
            },
            isOnline: ambulance.isOnline ?? true, // Sends online status to UI
            recentReviews 
        };

        res.json({
            success: true,
            data
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getAmbulanceCoupons = async (req, res) => {
    try {
        const { ambulanceId } = req.params; // Params se ID le rahe hain
        const today = new Date();

        const coupons = await Coupon.find({
            $or: [
                { vendorId: ambulanceId }, // Driver ke apne coupons
                { isAdminCreated: true, vendorType: { $in: ['Ambulance', 'All'] } } // Admin ke generic coupons
            ],
            isActive: true,
            expiryDate: { $gt: today },
            startDate: { $lt: today }
        }).sort({ createdAt: -1 });

        res.json({ success: true, count: coupons.length, data: coupons });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. VALIDATE COUPON (Checkout Logic) ---
const validateAmbulanceCoupon = async (req, res) => {
    try {
        const { couponCode, subtotal } = req.body;
        const userId = req.user.id;

        const coupon = await Coupon.findOne({ couponName: couponCode.toUpperCase(), isActive: true });

        if (!coupon) return res.status(404).json({ success: false, message: "Invalid Coupon Code" });

        // Production Checks
        if (new Date() > coupon.expiryDate) return res.status(400).json({ message: "Coupon Expired" });
        if (subtotal < coupon.minOrderAmount) return res.status(400).json({ message: `Min order should be ₹${coupon.minOrderAmount}` });

        // Usage Check
        const userUsage = coupon.usedBy.find(u => u.userId.toString() === userId.toString());
        if (userUsage && userUsage.usageCount >= coupon.maxUsagePerUser) {
            return res.status(400).json({ message: "You have exceeded the usage limit for this coupon" });
        }

        // Calculation
        let discount = (subtotal * coupon.discountPercentage) / 100;
        if (discount > coupon.maxDiscount) discount = coupon.maxDiscount;

        res.json({ 
            success: true, 
            data: {
                couponId: coupon._id,
                discountAmount: discount,
                finalTotal: subtotal - discount
            } 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- PRIVATE HELPER: Shared Pricing Logic ---
const getFinalFare = async (params, userId) => {
    let { 
        ambulanceId, 
        serviceType, 
        staffType, 
        couponCode, 
        pickupLat, 
        pickupLng, 
        dropLat, 
        dropLng,
        pickupLocation,
        hospitalId,
        pickupHospitalId
    } = params;
    
    const cleanCoupon = (couponCode && couponCode !== "null" && couponCode !== "undefined") ? String(couponCode).trim().toUpperCase() : null;
    const isFree = (serviceType === 'Accident emergency');

    let amb = null;
    if (ambulanceId && mongoose.isValidObjectId(ambulanceId)) {
        amb = await Ambulance.findById(ambulanceId);
    }

    // 1. Base Price & Per KM Rate from Ambulance Schema (with fallback)
    const baseAmbulanceFixedPrice = Number(amb?.pricing?.fixedPrice || 2000);
    const baseDistance = Number(amb?.pricing?.baseDistance || 5);
    const pricePerKM = Number(amb?.pricing?.pricePerKM || 0);

    // 2. Safe Coordinates Extraction
    let pLat = pickupLat;
    let pLng = pickupLng;

    if (pickupLocation) {
        if (typeof pickupLocation === 'object') {
            pLat = pLat || pickupLocation.lat;
            pLng = pLng || pickupLocation.lng;
        } else if (typeof pickupLocation === 'string') {
            try {
                const parsedLoc = JSON.parse(pickupLocation);
                pLat = pLat || parsedLoc.lat;
                pLng = pLng || parsedLoc.lng;
            } catch (e) {}
        }
    }

    let dLat = dropLat;
    let dLng = dropLng;

    // For Referral: Origin Hospital Coordinates
    if ((!pLat || !pLng) && pickupHospitalId && mongoose.isValidObjectId(pickupHospitalId)) {
        try {
            const originHosp = await Hospital.findById(pickupHospitalId).select('location').lean();
            if (originHosp?.location?.lat) {
                pLat = originHosp.location.lat;
                pLng = originHosp.location.lng;
            }
        } catch (e) {}
    }

    // For Destination Hospital Coordinates
    if ((!dLat || !dLng) && hospitalId && mongoose.isValidObjectId(hospitalId)) {
        try {
            const destHosp = await Hospital.findById(hospitalId).select('location').lean();
            if (destHosp?.location?.lat) {
                dLat = destHosp.location.lat;
                dLng = destHosp.location.lng;
            }
        } catch (e) {}
    }

    // Calculate Distance Surge safely
    let dynamicDistanceSurge = 0;
    if (pLat && pLng && dLat && dLng && pricePerKM > 0) {
        try {
            const totalDistance = await getDistance(Number(pLat), Number(pLng), Number(dLat), Number(dLng));
            const extraKM = totalDistance - baseDistance;
            if (extraKM > 0) {
                dynamicDistanceSurge = Math.round(extraKM * pricePerKM);
            }
        } catch (e) {}
    }

    let originalAmbulanceCharge = baseAmbulanceFixedPrice + dynamicDistanceSurge; 
    let ambulanceCharge = isFree ? 0 : originalAmbulanceCharge;
    
    let isSubscriptionApplied = false;
    let planName = "";
    let userSubscriptionId = null;

    // 3. Subscription Benefit Check
    if (!isFree && userId) {
        try {
            const ambBenefit = await checkAndApplyBenefit(userId, 'freeAmbulanceTripsCount', ambulanceCharge);
            if (ambBenefit.isApplied) {
                ambulanceCharge = 0;
                isSubscriptionApplied = true;

                const activeSub = await UserSubscription.findOne({
                    userId,
                    status: 'Active',
                    endDate: { $gt: new Date() }
                }).populate({
                    path: 'planId',
                    populate: [{ path: 'categoryId' }, { path: 'diseaseIds' }]
                });

                if (activeSub && activeSub.planId) {
                    planName = activeSub.planId.name || "Premium Care Plan";
                    userSubscriptionId = activeSub._id;
                }
            }
        } catch (e) {}
    }

    // 4. Supporting Staff Charges (Doctor / Nurse)
    let supportingStaffCharge = 0;
    if (!isFree && staffType && amb) {
        let staffList = [];
        if (Array.isArray(staffType)) {
            staffList = staffType;
        } else if (typeof staffType === 'string') {
            try {
                const parsed = JSON.parse(staffType);
                staffList = Array.isArray(parsed) ? parsed : staffType.split(',');
            } catch (e) {
                staffList = staffType.split(',');
            }
        }
        staffList = staffList.map(s => String(s).trim());

        if (staffList.includes('Doctor')) {
            supportingStaffCharge += Number(amb.supportStaff?.doctor?.price || 0);
        }
        if (staffList.includes('Nurse')) {
            supportingStaffCharge += Number(amb.supportStaff?.nurse?.price || 0);
        }
    }

    // 5. Subtotal & Coupon Discount
    let subtotal = isFree ? originalAmbulanceCharge : (ambulanceCharge + supportingStaffCharge);
    let discount = 0;
    let couponId = null;
    let finalCouponCode = null;

    if (cleanCoupon && !isFree) {
        try {
            const coupon = await Coupon.findOne({ couponName: cleanCoupon, isActive: true });
            if (coupon) {
                const today = new Date();
                let isLimitMet = false;
                if (userId && coupon.usedBy) {
                    const userUsage = coupon.usedBy.find(u => u.userId && u.userId.toString() === userId.toString());
                    isLimitMet = userUsage ? userUsage.usageCount >= coupon.maxUsagePerUser : false;
                }

                if (today <= coupon.expiryDate && subtotal >= coupon.minOrderAmount && !isLimitMet) {
                    discount = (subtotal * coupon.discountPercentage) / 100;
                    if (discount > coupon.maxDiscount) discount = coupon.maxDiscount;
                    
                    couponId = coupon._id;
                    finalCouponCode = coupon.couponName;
                }
            }
        } catch (e) {}
    }

    return { 
        ambulanceCharge, 
        originalAmbulanceCharge,
        supportingStaffCharge, 
        subtotal,
        discount: Math.round(discount), 
        total: isFree ? 0 : Math.max(0, Math.round(subtotal - discount)),
        isFree, 
        couponId, 
        finalCouponCode,
        isSubscriptionApplied,
        userSubscriptionId,
        planName
    };
};

// --- 1. CHECKOUT API (Updated with COD Check) ---
const calculateAmbulanceFare = async (req, res) => {
    try {
        // 🚀 SMART COD CHECK: Passes req.user.id
        const isCodAllowed = await isCodEnabled('Ambulance', req.user ? req.user.id : null);
        const fare = await getFinalFare(req.body, req.user ? req.user.id : null);
        
        res.json({ 
            success: true, 
            isCodAvailable: isCodAllowed, // 👈 True for subscribers
            data: fare 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

//  UNIVERSAL CONFIRM BOOKING (Updated with Real Valuation & No Accidental OTP)
const confirmAmbulanceBooking = async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await User.findById(userId);

        if (!user || user.isActive === false || user.isBanned === true) {
            return res.status(403).json({
                success: false,
                isBanned: true,
                message: user?.banReason || "Your account is suspended. Please contact Admin."
            });
        }

        let body = { ...req.body };
        if (typeof body.pricing === 'string') {
            try { body.pricing = JSON.parse(body.pricing); } catch (e) { body.pricing = {}; }
        }
        if (typeof body.patientDetails === 'string') {
            try { body.patientDetails = JSON.parse(body.patientDetails); } catch (e) { body.patientDetails = {}; }
        }
        if (typeof body.pickupLocation === 'string') {
            try { body.pickupLocation = JSON.parse(body.pickupLocation); } catch (e) { body.pickupLocation = { address: body.pickupLocation }; }
        }
        if (typeof body.staffType === 'string') {
            try {
                const parsed = JSON.parse(body.staffType);
                body.staffType = Array.isArray(parsed) ? parsed : body.staffType.split(',');
            } catch (e) { body.staffType = body.staffType.split(','); }
        }

        const { 
            ambulanceId, hospitalId, pickupHospitalId, serviceType, 
            triageLevel, patientDetails = {}, staffType = [],
            scheduledDate, appointmentTime,
            reason, referralReason, incidentDescription, 
            policeRequired, fireRequired 
        } = body;

        const isAccidental = (serviceType === 'Accident emergency');

        // =========================================================================
        // 🚨 PRE-BOOKING AVAILABILITY CHECK FOR ACCIDENTAL SOS
        // =========================================================================
        if (isAccidental) {
            // Unverified user 1-booking limit
            if (!user.isPhoneVerified && user.accidentalBookingCount >= 1) {
                return res.status(403).json({
                    success: false,
                    requirePhoneVerification: true,
                    message: "Free emergency booking limit reached for unverified number. Please verify your phone number via OTP in profile."
                });
            }

            // Check if at least 1 driver is active, approved, online & free
            const busyAmbs = await Booking.find({
                status: { $in: ['Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] }
            }).select('ambulanceId').lean();
            const busyIds = busyAmbs.filter(b => b.ambulanceId).map(b => b.ambulanceId.toString());

            const freeDriversCount = await Ambulance.countDocuments({
                _id: { $nin: busyIds },
                isActive: true,
                profileStatus: 'Approved',
                isOnline: true,
                availableForEmergency: true
            });

            // ❌ AGAR KOI DRIVER NAHI HAI: Direct reject with 108/112 helpline (No DB dead booking)
            if (freeDriversCount === 0) {
                return res.status(200).json({
                    success: false,
                    isServiceAvailable: false,
                    canBook: false,
                    message: "Our ambulance fleet in your area is currently engaged in critical emergencies. Please dial Government 108 Ambulance or 112 Emergency immediately.",
                    emergencyHelplines: getEmergencyHelplinesData()
                });
            }
        }

        // Targeted ambulance for Medical/Referral
        let targetAmbulance = null;
        if (!isAccidental && ambulanceId && mongoose.isValidObjectId(ambulanceId)) {
            targetAmbulance = await Ambulance.findById(ambulanceId);
        }

        const cleanHospitalId = (hospitalId && mongoose.isValidObjectId(hospitalId)) ? hospitalId : null;
        const cleanPickupHospitalId = (pickupHospitalId && mongoose.isValidObjectId(pickupHospitalId)) ? pickupHospitalId : null;
        const activePaymentMethod = isAccidental ? 'Online' : (body.paymentMethod || 'Online');

        // COD Policy Check
        if (activePaymentMethod === 'COD' && !isAccidental) {
            const isCodAllowed = await isCodEnabled('Ambulance', userId);
            if (!isCodAllowed) {
                return res.status(400).json({
                    success: false,
                    message: "Cash on Delivery is currently disabled for Ambulance bookings. Please pay online to confirm your ride."
                });
            }
        }

        const fare = await getFinalFare(body, userId);
        let referralCardPath = req.files?.referralCard ? `/uploads/ambulances/${req.files.referralCard[0].filename}` : null;
        let incidentPhotoPath = req.files?.incidentPhoto ? `/uploads/ambulances/${req.files.incidentPhoto[0].filename}` : null;
        const finalReason = reason || referralReason || incidentDescription || patientDetails.emergencyDescription || "";

        let finalPickupLocation = { address: "Pickup Location", lat: 30.7046, lng: 76.7179 };
        if (body.pickupLocation && typeof body.pickupLocation === 'object') {
            finalPickupLocation = {
                address: body.pickupLocation.address || "Pickup Location",
                lat: Number(body.pickupLocation.lat || 30.7046),
                lng: Number(body.pickupLocation.lng || 76.7179)
            };
        }

        const tempBookingId = isAccidental 
            ? `HK-ACC-${Date.now().toString().slice(-6)}` 
            : `HK-BOK-${Date.now().toString().slice(-6)}`;

        let staffList = Array.isArray(staffType) ? staffType : [];
        staffList = staffList.map(s => String(s).trim());

        let initialStatus = isAccidental ? 'Searching' : ((activePaymentMethod === 'COD' || fare.total === 0) ? 'Confirmed' : 'Pending');
        let initialPaymentStatus = isAccidental ? 'Paid' : ((activePaymentMethod === 'COD' || fare.total === 0) ? (fare.total === 0 ? 'Paid' : 'Pending') : 'Pending');

        let rzpOrder = null;
        if (!isAccidental && !fare.isFree && activePaymentMethod !== 'COD' && fare.total > 0) {
            try {
                rzpOrder = await createRazorpayOrder(fare.total, `receipt_${tempBookingId}`);
            } catch (rzpErr) {
                return res.status(400).json({ success: false, message: `Payment gateway error: ${rzpErr.message}` });
            }
        }

        const dynamicPickupOtp = isAccidental ? null : Math.floor(100000 + Math.random() * 900000).toString();

        const booking = await Booking.create({
            bookingId: tempBookingId,
            caseReference: generateCaseRef(serviceType || 'Medical Ambulance'),
            userId,
            ambulanceId: isAccidental ? null : (targetAmbulance ? targetAmbulance._id : null),
            hospitalId: cleanHospitalId,
            pickupHospitalId: cleanPickupHospitalId,
            serviceType: serviceType || 'Medical Ambulance',
            triageLevel: isAccidental ? 'Emergency' : (triageLevel || 'Routine'),
            scheduledAt: scheduledDate ? new Date(scheduledDate) : null,
            scheduledTime: appointmentTime || null,
            pickupLocation: finalPickupLocation,
            additionalSupport: {
                policeRequired: policeRequired === 'true' || policeRequired === true,
                fireRequired: fireRequired === 'true' || fireRequired === true
            },
            supportStaffSelected: {
                doctor: staffList.includes('Doctor'),
                nurse: staffList.includes('Nurse')
            },
            patientDetails: {
                ...patientDetails,
                emergencyDescription: finalReason,
                referralReason: finalReason,
                referralCard: referralCardPath || patientDetails.referralCard || null,
                incidentPhoto: incidentPhotoPath || patientDetails.incidentPhoto || null,
                condition: patientDetails.condition || (isAccidental ? "Critical" : "Stable")
            },
            pricing: {
                ambulanceCharge: fare.ambulanceCharge,
                originalAmbulanceCharge: fare.originalAmbulanceCharge,
                supportingStaffCharge: fare.supportingStaffCharge,
                subtotal: fare.subtotal,
                discount: fare.discount,
                total: fare.total
            },
            isFreeCase: isAccidental ? true : fare.isFree,
            paymentStatus: initialPaymentStatus,
            paymentMethod: activePaymentMethod,
            transactionId: rzpOrder ? rzpOrder.id : null,
            status: initialStatus,
            otp: dynamicPickupOtp,
            subscriptionDetails: {
                isSubscriptionApplied: fare.isSubscriptionApplied,
                userSubscriptionId: fare.userSubscriptionId,
                planName: fare.planName
            },
            trackingTimeline: [{
                status: initialStatus,
                timestamp: new Date(),
                note: isAccidental ? "Accident SOS broadcasted. Searching nearby available ambulances." : `Booking created under ${serviceType}.`
            }]
        });

        if (!isAccidental && fare.isSubscriptionApplied) {
            try { await deductBenefitCount(userId, 'freeAmbulanceTripsCount'); } catch (e) {}
        }

        // Accidental SOS broadcast
        if (isAccidental) {
            try {
                user.accidentalBookingCount = (user.accidentalBookingCount || 0) + 1;
                await user.save();

                await notifyAdminsAndVendor(
                    null,
                    'admin',
                    "🚨 CRITICAL: Emergency Accident Booking Placed!",
                    `Accidental SOS booking #${tempBookingId} at ${finalPickupLocation.address || 'Spot'}.`,
                    { bookingId: booking._id.toString(), type: 'emergency_booking_placed' }
                );
            } catch (e) {}

            return res.status(201).json({
                success: true,
                isServiceAvailable: true,
                canBook: true,
                message: "Accident Emergency SOS Dispatched! Searching nearest ambulances.",
                timeoutInSeconds: 60, // 👈 Frontend sets 60s timer
                booking
            });
        }

        // Medical / Referral direct confirm
        if (initialStatus === 'Confirmed' && targetAmbulance) {
            try {
                await Ambulance.findByIdAndUpdate(targetAmbulance._id, { $set: { availableForEmergency: false } });
                await sendPushNotification(
                    targetAmbulance._id,
                    'ambulance',
                    "🚨 New Confirmed Ambulance Ride!",
                    `New ${serviceType} booking #${tempBookingId} assigned to you. Destination: ${finalPickupLocation.address}.`,
                    { bookingId: booking._id.toString(), type: 'driver_assigned' }
                );
            } catch (e) {}
        }

        if (activePaymentMethod === 'COD' || fare.total === 0) {
            return res.status(201).json({ success: true, message: "Ambulance Booked & Confirmed Successfully!", booking });
        }

        res.status(201).json({
            success: true,
            message: "Razorpay order created for ambulance. Complete payment to confirm booking.",
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount,
            razorpayOrderId: rzpOrder.id,
            appointmentId: booking._id,
            bookingId: tempBookingId
        });

    } catch (error) {
        console.error("❌ [CONFIRM AMBULANCE BOOKING FATAL ERROR]:", error);
        res.status(500).json({ success: false, message: error.message || "Internal server error" });
    }
};


// INITIATE PAYMENT AFTER DRIVER ACCEPTS
// endpoint: POST /user/ambulance/initiate-payment/:bookingId
const initiateAmbulancePaymentAfterAcceptance = async (req, res) => {
    try {
        const { bookingId } = req.params;

        const booking = await Booking.findOne({ _id: bookingId, userId: req.user.id });
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        // Check if driver has actually accepted the ride first
        if (booking.status !== 'Confirmed') {
            return res.status(400).json({ success: false, message: "Cannot pay yet. Driver has not accepted the ride request." });
        }

        if (booking.paymentStatus === 'Paid') {
            return res.status(400).json({ success: false, message: "Payment has already been completed for this booking." });
        }

        // Create Razorpay Order
        const rzpOrder = await createRazorpayOrder(booking.pricing.total, `receipt_${booking.bookingId}`);

        // Update booking with Razorpay Order ID
        booking.transactionId = rzpOrder.id;
        await booking.save();

        res.json({
            success: true,
            message: "Razorpay order created. Complete payment to start navigation.",
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount, // in paise
            razorpayOrderId: rzpOrder.id,
            appointmentId: booking._id,
            bookingId: booking.bookingId
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// VERIFY AMBULANCE PAYMENT SIGNATURE
// endpoint: POST /user/ambulance/verify-payment
const verifyAmbulancePayment = async (req, res) => {
    try {
        const { appointmentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

        const isVerified = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        if (!isVerified) {
            return res.status(400).json({ success: false, message: "Payment signature verification failed." });
        }

        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const query = isObjectId ? { _id: appointmentId } : { bookingId: appointmentId };

        const booking = await Booking.findOne(query);
        if (!booking) return res.status(404).json({ success: false, message: "Ambulance booking not found." });

        const rzpDetails = await fetchAndMapRazorpayPayment(razorpayPaymentId, razorpaySignature);

        // 🚨 PAYMENT SUCCESS: Transition Status from 'Pending' to 'Confirmed'
        booking.paymentStatus = 'Paid';
        booking.status = 'Confirmed'; 
        booking.transactionId = razorpayPaymentId;
        booking.paymentDetails = rzpDetails; 
        
        booking.trackingTimeline.push({
            status: 'Confirmed',
            timestamp: new Date(),
            note: "Online payment verified successfully. Ride confirmed and assigned to ambulance driver."
        });

        await booking.save();

        // Lock Assigned Driver & Send Push Alert
        if (booking.ambulanceId) {
            await Ambulance.findByIdAndUpdate(booking.ambulanceId, { $set: { availableForEmergency: false } });
            
            await sendPushNotification(
                booking.ambulanceId,
                'ambulance',
                "🚨 New Paid Ride Assigned!",
                `Patient has completed online payment for booking #${booking.bookingId}. Start navigation to pickup spot.`,
                { bookingId: booking._id.toString(), type: 'driver_assigned' }
            );
        }

        // Notify Patient with OTP
        await sendPushNotification(
            booking.userId,
            'user',
            "Payment Received & Ambulance Confirmed! 🚑",
            `Your ride is confirmed. Share Pickup OTP: ${booking.otp} with driver on arrival.`,
            { bookingId: booking._id.toString(), otp: booking.otp, type: 'driver_assigned' }
        );

        res.json({
            success: true,
            message: "Payment verified successfully! Ambulance has been assigned.",
            data: booking
        });

    } catch (error) {
        console.error("Payment Verification Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};




// --- 5. GET BOOKING DETAILS (Tracking Screen 37/38) ---
const getBookingStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const isObjectId = mongoose.isValidObjectId(id);
        const query = isObjectId ? { _id: id } : { bookingId: id };

        const booking = await Booking.findOne(query)
            .populate('ambulanceId', 'name phone vehicleNumber vehicleType location driverInfo profilePic')
            .populate('hospitalId', 'name address location phone hospitalImage')
            .populate('pickupHospitalId', 'name address location phone'); // 🚀 SYNC FIX: Populates Origin Hospital
        
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
        res.json({ success: true, data: booking });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- 1. GET USER NUMBERS (Figma Screen: Choose your number) ---
const getUserNumbers = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('phone emergencyContact');
        let numbers = [user.phone];
        if (user.emergencyContact) {
            user.emergencyContact.forEach(c => numbers.push(c.phone));
        }
        res.json({ success: true, numbers });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// --- 3. UPLOAD INCIDENT PHOTO (Figma Screen: Capture Incident Photo) ---
const uploadIncidentPhoto = async (req, res) => {
    try {
        const { bookingId } = req.params;
        
        // Field name logic: 'incidentPhoto' use karein Postman/Flutter mein
        const photoPath = req.files && req.files.incidentPhoto ? 
            `/uploads/ambulances/${req.files.incidentPhoto[0].filename}` : null;

        if (!photoPath) return res.status(400).json({ message: "No photo uploaded or wrong field name" });

        const booking = await Booking.findByIdAndUpdate(bookingId, {
            'patientDetails.incidentPhoto': photoPath
        }, { new: true });

        res.json({ success: true, message: "Incident photo saved", data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 4. GET LIVE TRACKING DATA (100% Real Dynamic Telemetry) ---
// Updated: Removed hardcoded "5 mins", "4.8" rating, and "1,240 trips", replaced with live DB aggregations
const getLiveTracking = async (req, res) => {
    try {
        const { id } = req.params;
        const isObjectId = mongoose.isValidObjectId(id);
        const query = isObjectId ? { _id: id } : { bookingId: id };

        const booking = await Booking.findOne(query)
            .populate({
                path: 'ambulanceId',
                select: 'name phone vehicleNumber vehicleType location driverInfo profilePic averageRating totalReviews'
            })
            .populate('hospitalId', 'name address location')
            .populate('pickupHospitalId', 'name address location');

        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

        const driver = booking.ambulanceId;

        let realTripsCount = 0;
        if (driver?._id) {
            realTripsCount = await Booking.countDocuments({
                ambulanceId: driver._id,
                status: 'Delivered'
            });
        }

        let dynamicEta = "Arriving";
        if (driver?.location?.lat && booking.pickupLocation?.lat) {
            const distance = await getDistance(
                driver.location.lat,
                driver.location.lng,
                booking.pickupLocation.lat,
                booking.pickupLocation.lng
            );

            if (distance <= 0.3) {
                dynamicEta = "Arrived on Spot";
            } else {
                const estimatedMinutes = Math.max(1, Math.round(distance * 3));
                dynamicEta = `${estimatedMinutes} mins`;
            }
        }

        const trackingData = {
            status: booking.status,
            otp: booking.otp,
            serviceType: booking.serviceType,
            eta: dynamicEta,
            driver: {
                name: driver?.driverInfo?.fullName || driver?.name || "Assigned Driver",
                phone: driver?.phone || "N/A",
                rating: driver?.averageRating || 5.0,
                totalReviews: driver?.totalReviews || 0,
                trips: realTripsCount > 0 ? `${realTripsCount} Trips` : "New Partner",
                profilePic: driver?.profilePic || null
            },
            vehicle: {
                plateNumber: driver?.vehicleNumber || "Verified Vehicle",
                type: driver?.vehicleType || "Ambulance"
            },
            location: driver?.location || { lat: 0, lng: 0 },
            pickupHospital: booking.pickupHospitalId || null,
            destinationHospital: booking.hospitalId || null,
            timeline: booking.trackingTimeline || []
        };

        res.json({ success: true, data: trackingData });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// CANCEL AMBULANCE BOOKING (With 2-Cancellation Daily Auto-Ban & Admin Fee Deduction)
const cancelAmbulanceBooking = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const userId = req.user.id;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found." });

        if (user.isActive === false || user.isBanned === true) {
            return res.status(403).json({ 
                success: false, 
                isBanned: true,
                canRequestUnban: true,
                message: user.banReason || "Your account has been suspended due to cancellation violations." 
            });
        }

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            $or: [
                { _id: isObjectId ? new mongoose.Types.ObjectId(id) : new mongoose.Types.ObjectId() },
                { bookingId: String(id).trim() }
            ],
            userId: user._id
        };

        const booking = await Booking.findOne(query);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Ambulance booking not found." });
        }

        if (booking.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: "This booking is already cancelled." });
        }
        if (booking.status === 'Delivered') {
            return res.status(400).json({ success: false, message: "Cannot cancel completed ambulance trips." });
        }

        const isAccidental = (booking.serviceType === 'Accident emergency');
        let policyResult = { cancellationFee: 0, driverCompensation: 0, refundAmount: 0 };

        if (!isAccidental) {
            const specificVendorType = booking.serviceType === 'Referral Ambulance' ? 'Ambulance-Referral' : 'Ambulance-Medical';
            policyResult = await processCancellationRefund(booking, specificVendorType);
        }

        const cancellationFee = Number(policyResult.cancellationFee || 0);
        const driverCompensation = Number(policyResult.driverCompensation || 0);
        const refundAmount = Number(policyResult.refundAmount || 0);

        booking.status = 'Cancelled';
        booking.cancelledBy = 'User';
        booking.cancellationReason = reason || "Cancelled by User";
        
        if (!booking.pricing) booking.pricing = {};
        booking.pricing.cancellationFeeApplied = cancellationFee;

        if (booking.paymentStatus === 'Paid') {
            booking.paymentStatus = 'Refund-Initiated';
        }

        if (!booking.trackingTimeline) booking.trackingTimeline = [];
        booking.trackingTimeline.push({
            status: 'Cancelled',
            timestamp: new Date(),
            note: reason ? `Cancelled by User. Reason: ${reason}` : "Cancelled by User."
        });

        // 1. Credit Driver Compensation Fee to Driver's Wallet
        if (booking.ambulanceId) {
            await Ambulance.findByIdAndUpdate(booking.ambulanceId, { $set: { availableForEmergency: true } });
            
            if (driverCompensation > 0) {
                await creditVendorCompensation(booking.ambulanceId, 'Ambulance', driverCompensation, booking.bookingId, 'Cancellation Fee');
            }

            try {
                await sendPushNotification(
                    booking.ambulanceId, 
                    'ambulance', 
                    "Ride Cancelled", 
                    driverCompensation > 0 
                        ? `Patient cancelled ride. ₹${driverCompensation} compensation credited to your wallet.`
                        : "Patient has cancelled this ambulance request.",
                    { bookingId: booking._id.toString(), type: 'booking_cancelled' }
                );
            } catch (e) {}
        }

        // 2. Refund Subscription Benefit Count back to user
        if (booking.subscriptionDetails?.isSubscriptionApplied) {
            await refundBenefitCount(userId, 'freeAmbulanceTripsCount');
        }

        // 3. Cancel Hospital Pre-Admission
        if (booking.bookingId) {
            try {
                await Appointment.findOneAndUpdate(
                    { transactionId: booking.bookingId },
                    { $set: { status: 'Cancelled-By-User', 'tracking.status': 'Cancelled' } }
                );
            } catch (e) {}
        }

        await booking.save(); // Save cancellation first

        // =========================================================================
        // 🚨 4. RESTORED: 24-HOURS ACCIDENTAL AUTO-BAN ENGINE (2 CANCELLATIONS = BAN)
        // =========================================================================
        let isUserBannedNow = false;
        let banMessage = "";

        if (isAccidental) {
            const now = new Date();
            const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 Hours rolling window

            // If user was unbanned recently within last 24h, count only cancellations after unban
            const effectiveStartDate = (user.unbannedAt && new Date(user.unbannedAt) > last24Hours)
                ? new Date(user.unbannedAt)
                : last24Hours;

            // Count accidental cancellations for this user in last 24h
            const cancellationsIn24Hrs = await Booking.countDocuments({
                userId: user._id,
                serviceType: 'Accident emergency',
                status: 'Cancelled',
                updatedAt: { $gte: effectiveStartDate }
            });

            // 🚨 IF 2 OR MORE ACCIDENTAL CANCELLATIONS IN 24 HOURS ➔ AUTO BAN USER!
            if (cancellationsIn24Hrs >= 2) {
                isUserBannedNow = true;
                user.isActive = false;
                user.isBanned = true;
                user.banReason = "Account automatically suspended: 2 accidental emergency bookings were cancelled within 24 hours. You can submit an unban request to Admin.";
                user.token = null; // Auto-logout session
                await user.save();

                banMessage = "⚠️ CRITICAL: Your account has been suspended for cancelling 2 accidental emergency bookings in 24 hours. Please submit an Unban Request to Admin from the app.";
            }
        }

        res.json({
            success: true,
            message: banMessage || (cancellationFee > 0 
                ? `Booking cancelled. A cancellation fee of ₹${cancellationFee} was deducted. Remaining ₹${refundAmount} sent to Refund Queue.`
                : "Booking cancelled successfully."),
            isBanned: isUserBannedNow,
            canRequestUnban: isUserBannedNow,
            data: {
                cancellationFee,
                driverCompensation,
                refundAmount,
                booking
            }
        });

    } catch (error) {
        console.error("Cancel Ambulance Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};



// --- 2. GET USER BOOKING HISTORY (PAGINATED) ---
const getMyAmbulanceBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const { type, serviceType, status } = req.query;
        const activeFilter = (type || serviceType || "").toLowerCase().trim();

        // Base Query: Logged-in user's bookings
        const query = { userId: req.user.id };

        // 🚀 SYNC FIX: Clean 3-Service Type Filtering
        if (activeFilter && activeFilter !== 'all') {
            if (activeFilter === 'accidental' || activeFilter === 'accident emergency') {
                query.serviceType = 'Accident emergency';
            } 
            else if (activeFilter === 'medical' || activeFilter === 'medical ambulance') {
                query.serviceType = 'Medical Ambulance';
            } 
            else if (activeFilter === 'referral' || activeFilter === 'referral ambulance') {
                query.serviceType = 'Referral Ambulance';
            } 
            else {
                query.serviceType = serviceType || type;
            }
        }

        if (status && status !== 'All') {
            query.status = status;
        }

        const [bookings, total] = await Promise.all([
            Booking.find(query)
                .populate('ambulanceId', 'name vehicleNumber vehicleType phone profilePic driverInfo')
                .populate('hospitalId', 'name address location phone hospitalImage')
                .populate('pickupHospitalId', 'name address location phone') // Referral Hospital A
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Booking.countDocuments(query)
        ]);

        res.json({ 
            success: true, 
            count: bookings.length, 
            totalItems: total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            filterApplied: activeFilter || 'all',
            data: bookings 
        });

    } catch (error) { 
        console.error("Get My Bookings Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};



// --- NEW: GET ALL REVIEWS FOR A SPECIFIC AMBULANCE (Paginated list with Comments) ---
// GET /user/ambulance/reviews/:id?page=1&limit=10
const getAmbulanceReviewsList = async (req, res) => {
    try {
        const { id } = req.params; // Ambulance Document _id
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10; // Default limit 10 reviews per page
        const skip = (page - 1) * limit;

        // Verify if ambulance exists first
        const ambulanceExists = await Ambulance.exists({ _id: id });
        if (!ambulanceExists) {
            return res.status(404).json({ success: false, message: "Ambulance/Driver record not found." });
        }

        // 1. Total matching reviews count
        const total = await Review.countDocuments({ targetId: id, targetType: 'Ambulance' });

        // 2. Fetch paginated comments list
        const reviews = await Review.find({ targetId: id, targetType: 'Ambulance' })
            .select('userName rating comment createdAt')
            .sort({ createdAt: -1 }) // Newest feedback first
            .skip(skip)
            .limit(limit)
            .lean();

        res.json({
            success: true,
            totalReviews: total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: reviews
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


const rateAmbulanceBooking = async (req, res) => {
    try {
        const { bookingId, rating, comment } = req.body;

        if (!bookingId || !rating) {
            return res.status(400).json({ success: false, message: "bookingId and rating (1-5) are required." });
        }

        const numRating = Number(rating);
        if (isNaN(numRating) || numRating < 1 || numRating > 5) {
            return res.status(400).json({ success: false, message: "Rating must be a number between 1 and 5." });
        }

        // 🚨 Resolve booking safely by Mongo _id OR custom bookingId
        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = {
            $or: [
                { _id: isObjectId ? new mongoose.Types.ObjectId(bookingId) : new mongoose.Types.ObjectId() },
                { bookingId: String(bookingId).trim() }
            ],
            userId: new mongoose.Types.ObjectId(req.user.id)
        };

        const booking = await Booking.findOne(query);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Ambulance booking not found for this user." });
        }

        // Only completed trips can be reviewed
        if (booking.status !== 'Delivered') {
            return res.status(400).json({ 
                success: false, 
                message: `You can only rate trips that are completed ('Delivered'). Current status is '${booking.status}'.` 
            });
        }

        // Check for existing review
        const existingReview = await Review.findOne({ 
            userId: req.user.id, 
            orderId: booking._id 
        });

        if (existingReview) {
            return res.status(400).json({ 
                success: false, 
                message: "You have already submitted a review for this completed trip." 
            });
        }

        // Save Review
        await Review.create({
            userId: req.user.id,
            userName: req.user.name || "Verified User",
            targetId: booking.ambulanceId,
            targetType: 'Ambulance',
            orderId: booking._id, // Mongo ObjectId
            rating: numRating,
            comment: comment ? String(comment).trim() : ""
        });

        // Recalculate average rating for Ambulance Profile
        if (booking.ambulanceId) {
            const stats = await Review.aggregate([
                { $match: { targetId: booking.ambulanceId, targetType: 'Ambulance' } },
                { $group: { _id: null, averageRating: { $avg: "$rating" }, totalReviews: { $sum: 1 } } }
            ]);

            if (stats.length > 0) {
                await Ambulance.findByIdAndUpdate(booking.ambulanceId, {
                    $set: {
                        averageRating: Number(stats[0].averageRating.toFixed(1)),
                        totalReviews: stats[0].totalReviews
                    }
                });
            }
        }

        res.json({ success: true, message: "Thank you for rating our emergency ambulance service!" });

    } catch (error) {
        console.error("Ambulance Rating Error:", error);
        res.status(500).json({ success: false, message: "Server Error: " + error.message });
    }
};


// =========================================================================
// 🚀 1. NEW: SHORT REGISTRATION & 1-CLICK ACCIDENTAL BOOKING (WITHOUT OTP)
// Endpoint: POST /user/ambulance/accidental/short-book
// =========================================================================
const shortRegisterAndBookAccidental = async (req, res) => {
    try {
        const { 
            name, phone, countryCode,
            pickupAddress, pickupLat, pickupLng,
            emergencyDescription, policeRequired, fireRequired 
        } = req.body;

        if (!phone) {
            return res.status(400).json({ success: false, message: "Phone number is required for emergency dispatch." });
        }

        const cleanPhone = String(phone).trim().replace(/\D/g, "").slice(-10);
        const fullPhone = countryCode ? `${countryCode}${cleanPhone}` : `+91${cleanPhone}`;

        // 🚨 PRE-CHECK: Check if at least 1 driver is active, online & free
        const busyAmbs = await Booking.find({
            status: { $in: ['Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] }
        }).select('ambulanceId').lean();
        const busyIds = busyAmbs.filter(b => b.ambulanceId).map(b => b.ambulanceId.toString());

        const freeDriversCount = await Ambulance.countDocuments({
            _id: { $nin: busyIds },
            isActive: true,
            profileStatus: 'Approved',
            isOnline: true,
            availableForEmergency: true
        });

        // ❌ AGAR KOI DRIVER NAHI HAI: Direct reject with 108/112 (No dead user/booking created)
        if (freeDriversCount === 0) {
            return res.status(200).json({
                success: false,
                isServiceAvailable: false,
                canBook: false,
                message: "Our ambulance fleet in your area is currently engaged in critical emergencies. Please dial Government 108 Ambulance or 112 Emergency immediately.",
                emergencyHelplines: getEmergencyHelplinesData()
            });
        }

        let user = await User.findOne({ phone: cleanPhone });
        let isNewUser = false;

        if (user) {
            if (user.isActive === false || user.isBanned === true) {
                return res.status(403).json({
                    success: false,
                    isBanned: true,
                    message: user.banReason || "Your account has been suspended. Please contact Admin."
                });
            }

            if (!user.isPhoneVerified && user.accidentalBookingCount >= 1) {
                return res.status(403).json({
                    success: false,
                    requirePhoneVerification: true,
                    message: "Free emergency booking limit reached for unverified number. Please verify your phone number via OTP."
                });
            }

            user.accidentalBookingCount = (user.accidentalBookingCount || 0) + 1;
            await user.save();
        } else {
            isNewUser = true;
            const tempPassword = await bcrypt.hash(`HKEmergency@${cleanPhone.slice(-4)}`, 10);
            user = await User.create({
                name: name || "Accident Victim",
                phone: cleanPhone,
                countryCode: countryCode || "+91",
                password: tempPassword,
                isPhoneVerified: false,
                isShortRegistered: true,
                accidentalBookingCount: 1,
                role: 'user',
                profileStatus: 'Approved'
            });
        }

        const token = generateToken(user._id, 'user');
        const tempBookingId = `HK-ACC-${Date.now().toString().slice(-6)}`;

        const booking = await Booking.create({
            bookingId: tempBookingId,
            caseReference: generateCaseRef('Accident emergency'),
            userId: user._id,
            serviceType: 'Accident emergency',
            triageLevel: 'Emergency',
            pickupLocation: {
                address: pickupAddress || "Accident Spot Location",
                lat: Number(pickupLat || 30.7046),
                lng: Number(pickupLng || 76.7179)
            },
            patientDetails: {
                name: name || "Accident Victim",
                phone: fullPhone,
                emergencyDescription: emergencyDescription || "Roadside Accident Emergency",
                condition: "Critical"
            },
            additionalSupport: {
                policeRequired: policeRequired === 'true' || policeRequired === true,
                fireRequired: fireRequired === 'true' || fireRequired === true
            },
            pricing: {
                ambulanceCharge: 0,
                originalAmbulanceCharge: 2000,
                subtotal: 2000,
                discount: 0,
                total: 0
            },
            isFreeCase: true,
            paymentStatus: 'Paid',
            paymentMethod: 'Online',
            status: 'Searching',
            otp: null,
            trackingTimeline: [{
                status: 'Searching',
                timestamp: new Date(),
                note: `Accidental 1-Click SOS placed by ${user.name}. Searching nearest available drivers.`
            }]
        });

        try {
            await notifyAdminsAndVendor(
                null,
                'admin',
                "🚨 CRITICAL: Accidental 1-Click SOS Dispatched!",
                `Accident emergency reported at ${pickupAddress || 'Spot'}. Searching nearest ambulances.`,
                { bookingId: booking._id.toString(), type: 'emergency_sos_broadcast' }
            );
        } catch (e) {}

        res.status(201).json({
            success: true,
            isServiceAvailable: true,
            canBook: true,
            message: "Accidental Ambulance Dispatched! Searching nearest ambulances.",
            token,
            isNewUser,
            bookingId: tempBookingId,
            timeoutInSeconds: 60, // 👈 60-Second Timer
            booking
        });

    } catch (error) {
        console.error("Short Accidental Booking Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// =========================================================================
// 🚀 1-MINUTE ACCIDENTAL SOS ESCALATION & GOVT HELPLINE FALLBACK
// Endpoint: POST /user/ambulance/sos/escalate/:bookingId
// =========================================================================
const escalateAccidentalSos = async (req, res) => {
    try {
        const { bookingId } = req.params;

        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = {
            $or: [
                { _id: isObjectId ? new mongoose.Types.ObjectId(bookingId) : new mongoose.Types.ObjectId() },
                { bookingId: String(bookingId).trim() }
            ],
            serviceType: 'Accident emergency'
        };

        const booking = await Booking.findOne(query);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Accident booking record not found." });
        }

        // 🚀 CASE A: Driver accepted within 60s (Race condition check)
        if (booking.status !== 'Searching' && booking.ambulanceId) {
            return res.json({
                success: true,
                isAssigned: true,
                status: booking.status,
                message: "An ambulance driver has accepted your request and is en-route!",
                data: booking
            });
        }

        // 🚨 CASE B: 60 Seconds Over & No Driver Accepted
        // Database update: Mark as Cancelled by System (Unfulfilled)
        booking.status = 'Cancelled';
        booking.cancelledBy = 'System';
        booking.cancellationReason = "No partner ambulance accepted within 60-second emergency window due to sudden field unavailability.";
        
        if (!booking.trackingTimeline) booking.trackingTimeline = [];
        booking.trackingTimeline.push({
            status: 'Unfulfilled Timeout',
            timestamp: new Date(),
            note: "60-second search window expired. Closed by system to prevent hanging state. Patient prompted with Government 108/112 Emergency helplines."
        });

        await booking.save();

        // High priority alarm to Admin Control Room
        try {
            await notifyAdminsAndVendor(
                null,
                'admin',
                "🚨 CRITICAL SOS UNFULFILLED (60s Timeout)!",
                `Accidental SOS #${booking.bookingId} at ${booking.pickupLocation.address} expired without driver acceptance. Bystander advised to call 108/112.`,
                { bookingId: booking._id.toString(), type: 'sos_unfulfilled_alert' }
            );
        } catch (e) {}

        // Empathic message + Government Helplines response
        res.status(200).json({
            success: true,
            isAssigned: false,
            isCancelled: true,
            status: "Cancelled",
            bookingId: booking.bookingId,
            message: "Our partner ambulance drivers are currently occupied on urgent trauma runs and unable to accept this request due to unforeseen emergency conditions. Please dial Government 108 Ambulance or 112 Emergency immediately.",
            emergencyHelplines: getEmergencyHelplinesData()
        });

    } catch (error) {
        console.error("Escalate SOS Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getAmbulanceMasterData,
    getNearbyHospitals,
    getNearestAmbulances,getAmbulanceDetails,
    // createAmbulanceBooking,
    getBookingStatus, getAmbulanceCoupons , validateAmbulanceCoupon,
    calculateAmbulanceFare,
    confirmAmbulanceBooking,initiateAmbulancePaymentAfterAcceptance,
    verifyAmbulancePayment, 
    // updateReview,addReview,

    getUserNumbers,
    // createAccidentalBooking,
    uploadIncidentPhoto,
    getLiveTracking,

    // createReferralBooking,
    cancelAmbulanceBooking,getMyAmbulanceBookings,


    getAmbulanceReviewsList,
    rateAmbulanceBooking,
    shortRegisterAndBookAccidental,

    escalateAccidentalSos

    
};