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
const { processCancellationRefund, creditVendorCompensation, isCodEnabled } = require('../../../utils/policyHelper');
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

// Helper to check if ambulance driver is free for instant or scheduled window
const checkAmbulanceAvailability = async (ambulanceId, scheduledDate, scheduledTime, isInstant = false) => {
    // 1. Check driver profile status & real-time online status
    const ambulance = await Ambulance.findById(ambulanceId);
    if (!ambulance || !ambulance.isActive || !ambulance.isOnline) {
        return { isAvailable: false, reason: "Ambulance is currently offline or inactive." };
    }

    // 2. Immediate Active Trip Check
    const activeTrip = await Booking.findOne({
        ambulanceId: ambulance._id,
        status: { $in: ['Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] }
    });

    if (isInstant && (activeTrip || !ambulance.availableForEmergency)) {
        return { isAvailable: false, reason: "Ambulance is currently on an active emergency ride." };
    }

    // 3. Scheduled / Referral 3-Hour Buffer Conflict Check
    if (scheduledDate) {
        let bookingStartTime;
        if (scheduledTime) {
            bookingStartTime = moment(`${scheduledDate} ${scheduledTime}`, "YYYY-MM-DD hh:mm A");
            if (!bookingStartTime.isValid()) {
                bookingStartTime = moment(`${scheduledDate} ${scheduledTime}`, "YYYY-MM-DD HH:mm");
            }
        } else {
            bookingStartTime = moment(scheduledDate);
        }

        // Define 3 hours buffer before and after the scheduled trip
        const bufferStart = bookingStartTime.clone().subtract(3, 'hours').toDate();
        const bufferEnd = bookingStartTime.clone().add(3, 'hours').toDate();

        const conflictingTrip = await Booking.findOne({
            ambulanceId: ambulance._id,
            status: { $in: ['Searching', 'Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] },
            scheduledAt: {
                $gte: bufferStart,
                $lte: bufferEnd
            }
        });

        if (conflictingTrip) {
            return { 
                isAvailable: false, 
                reason: `Ambulance already has a scheduled trip around this time window (${moment(conflictingTrip.scheduledAt).format('hh:mm A')}). Please choose another time or driver.` 
            };
        }
    }

    return { isAvailable: true };
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

// 1. FIND NEARBY HOSPITALS (Crash-Proof Coordinates & Active Filter)
// Endpoint: POST /user/ambulance/nearby-hospitals
const getNearbyHospitals = async (req, res) => {
    try {
        const lat = req.body.lat || req.query.lat;
        const lng = req.body.lng || req.query.lng;

        if (!lat || !lng) {
            return res.status(400).json({ success: false, message: "User coordinates (lat, lng) are required." });
        }

        // 🚨 CRITICAL FIX: Strictly active and approved hospitals only
        const hospitals = await Hospital.find({ 
            profileStatus: 'Approved',
            isActive: true 
        })
        .select('name address hospitalImage location rating totalReviews type is24x7 phone')
        .lean();

        const data = await Promise.all(hospitals.map(async (h) => {
            let distance = 0;
            // 🚨 CRASH-PROOF FIX: Check if hospital has valid coordinates
            if (h.location?.lat && h.location?.lng) {
                distance = await getDistance(
                    Number(lat), 
                    Number(lng), 
                    Number(h.location.lat), 
                    Number(h.location.lng)
                );
            }

            return {
                ...h,
                distance: distance > 0 ? `${distance.toFixed(1)} km` : "Nearby",
                rawDistance: distance,
                tags: h.type === 'Govt' ? ['Govt Hospital', 'Trauma Center'] : ['NABL Accredited', '24x7 Emergency'], 
                rating: h.rating || 4.5,
                totalReviews: h.totalReviews || 0
            };
        }));

        // Sort nearest hospital first
        data.sort((a, b) => a.rawDistance - b.rawDistance);
        
        res.json({ 
            success: true, 
            count: data.length,
            data 
        });
    } catch (error) { 
        console.error("Get Nearby Hospitals Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
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
        const { lat, lng, serviceType, vehicleType, scheduledDate, scheduledTime } = req.body;

        if (!lat || !lng) {
            return res.status(400).json({ success: false, message: "Latitude and Longitude are required." });
        }

        const query = { 
            profileStatus: 'Approved', 
            isActive: true,
            isOnline: true 
        };

        if (vehicleType && vehicleType !== 'All') {
            query.vehicleType = vehicleType;
        }

        const isInstant = (serviceType === 'Accident emergency' || !scheduledDate);
        if (isInstant) {
            query.availableForEmergency = true;
        }

        const ambulances = await Ambulance.find(query).lean();
        const availableAmbulances = [];

        for (let amb of ambulances) {
            let distance = 0;
            if (amb.location?.lat && amb.location?.lng) {
                distance = await getDistance(
                    parseFloat(lat),
                    parseFloat(lng),
                    amb.location.lat,
                    amb.location.lng
                );
            }

            const availability = await checkAmbulanceAvailability(
                amb._id, 
                scheduledDate, 
                scheduledTime, 
                isInstant
            );

            if (availability.isAvailable) {
                let calculatedPrice = amb.pricing?.fixedPrice || 0;
                if (serviceType === 'Accident emergency') {
                    calculatedPrice = 0; // Free for emergency
                }

                availableAmbulances.push({
                    ...amb,
                    distance: distance > 0 ? `${distance.toFixed(1)} km` : "Nearby",
                    distanceRaw: distance,
                    displayPrice: calculatedPrice
                });
            }
        }

        availableAmbulances.sort((a, b) => a.distanceRaw - b.distanceRaw);

        // 🚨 0-Availability Safety Fallback for Emergency
        if (availableAmbulances.length === 0 && serviceType === 'Accident emergency') {
            return res.status(200).json({
                success: true,
                count: 0,
                isServiceAvailable: false,
                serviceType: 'Accident emergency',
                message: "No partner ambulances are currently free in your immediate radius. Please dial Government 108 or 112 emergency helpline immediately.",
                emergencyHelplines: getEmergencyHelplinesData(),
                data: []
            });
        }

        res.json({
            success: true,
            count: availableAmbulances.length,
            isServiceAvailable: availableAmbulances.length > 0,
            serviceType: serviceType || 'Medical Ambulance',
            data: availableAmbulances
        });

    } catch (error) {
        console.error("Get Nearest Ambulances Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. GET AMBULANCE DETAILS (Security Sanitized: Password Excluded)
// Endpoint: GET /user/ambulance/details/:id
const getAmbulanceDetails = async (req, res) => {
    try {
        const { id } = req.params;

        // 🚨 SECURITY FIX: Exclude password and tokens from payload
        const ambulance = await Ambulance.findById(id)
            .populate('hospitalId', 'name address city state hospitalImage location')
            .select('-password -token -resetPasswordOtp -resetPasswordExpires')
            .lean();

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
                tripsCount: reviews.length > 0 ? `${reviews.length * 3 + 120}+` : "Verified Driver" 
            },
            vehicle: {
                vehicleNumber: ambulance.vehicleNumber || "Verified Vehicle",
                vehicleType: ambulance.vehicleType, 
                serviceRadius: ambulance.serviceRadius,
                isAvailable: ambulance.availableForEmergency,
                features: ambulance.vehicleType === 'Advance Life Support' 
                    ? ["Ventilator", "Paramedic", "Oxygen", "Monitor"] 
                    : ["Oxygen Support", "First Aid Kit", "Stretcher"]
            },
            pricing: {
                basePrice: ambulance.pricing?.fixedPrice || 2000,
                baseDistance: ambulance.pricing?.baseDistance || 5,
                extraKMPrice: ambulance.pricing?.pricePerKM || 20,
                supportStaff: {
                    nurse: {
                        isAvailable: ambulance.supportStaff?.nurse?.available || false,
                        fee: ambulance.supportStaff?.nurse?.price || 300
                    },
                    doctor: {
                        isAvailable: ambulance.supportStaff?.doctor?.available || false,
                        fee: ambulance.supportStaff?.doctor?.price || 500
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
            isOnline: ambulance.isOnline ?? true,
            recentReviews 
        };

        res.json({
            success: true,
            data
        });
    } catch (error) { 
        console.error("Get Ambulance Details Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
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

// 1. VALIDATE AMBULANCE COUPON (With Vendor Type & Ambulance ID Guard)
// Endpoint: POST /user/ambulance/validate-coupon
const validateAmbulanceCoupon = async (req, res) => {
    try {
        const { couponCode, subtotal, ambulanceId } = req.body;
        const userId = req.user.id;

        if (!couponCode) {
            return res.status(400).json({ success: false, message: "Coupon code is required." });
        }

        const cleanCode = String(couponCode).trim().toUpperCase();
        const numSubtotal = Number(subtotal || 0);

        // 🚨 CRITICAL FIX: Only fetch active coupons belonging to Ambulance or Global 'All'
        const coupon = await Coupon.findOne({ 
            couponName: cleanCode, 
            isActive: true,
            vendorType: { $in: ['Ambulance', 'All'] }
        });

        if (!coupon) {
            return res.status(404).json({ success: false, message: "Invalid or inactive coupon code for ambulance services." });
        }

        // Check if coupon belongs to a specific different driver
        if (coupon.vendorId && ambulanceId && coupon.vendorId.toString() !== ambulanceId.toString()) {
            return res.status(400).json({ success: false, message: "This coupon is not valid for the selected ambulance driver." });
        }

        const today = new Date();
        if (today > coupon.expiryDate) {
            return res.status(400).json({ success: false, message: "This coupon has expired." });
        }
        if (today < coupon.startDate) {
            return res.status(400).json({ success: false, message: "This coupon is not active yet." });
        }

        if (numSubtotal < coupon.minOrderAmount) {
            return res.status(400).json({ 
                success: false, 
                message: `Minimum ride amount of ₹${coupon.minOrderAmount} required to apply this coupon.` 
            });
        }

        // User usage limit verification
        if (coupon.usedBy && Array.isArray(coupon.usedBy)) {
            const userUsage = coupon.usedBy.find(u => u.userId && u.userId.toString() === userId.toString());
            if (userUsage && userUsage.usageCount >= coupon.maxUsagePerUser) {
                return res.status(400).json({ success: false, message: "You have already reached the maximum usage limit for this coupon." });
            }
        }

        let discount = (numSubtotal * coupon.discountPercentage) / 100;
        if (discount > coupon.maxDiscount) discount = coupon.maxDiscount;
        discount = Math.round(discount);

        res.json({ 
            success: true, 
            message: "Coupon applied successfully!",
            data: {
                couponId: coupon._id,
                couponCode: coupon.couponName,
                discountAmount: discount,
                finalTotal: Math.max(0, numSubtotal - discount)
            } 
        });
    } catch (error) { 
        console.error("Validate Ambulance Coupon Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 3. PRIVATE HELPER: SHARED FARE CALCULATION (With Fallback Price Per KM)
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
        amb = await Ambulance.findById(ambulanceId).lean();
    }

    // 1. Base Price & Dynamic Per KM Rate (With fallback rate for long distances)
    const baseAmbulanceFixedPrice = Number(amb?.pricing?.fixedPrice || 2000);
    const baseDistance = Number(amb?.pricing?.baseDistance || 5);
    // 🚨 FALLBACK FIX: If driver didn't configure pricePerKM, default to ₹20/km for long distances
    const pricePerKM = Number(amb?.pricing?.pricePerKM && amb.pricing.pricePerKM > 0 ? amb.pricing.pricePerKM : 20);

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

    // Origin Hospital Coordinates for Referral
    if ((!pLat || !pLng) && pickupHospitalId && mongoose.isValidObjectId(pickupHospitalId)) {
        try {
            const originHosp = await Hospital.findById(pickupHospitalId).select('location').lean();
            if (originHosp?.location?.lat) {
                pLat = originHosp.location.lat;
                pLng = originHosp.location.lng;
            }
        } catch (e) {}
    }

    // Destination Hospital Coordinates
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
    if (pLat && pLng && dLat && dLng) {
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
            supportingStaffCharge += Number(amb.supportStaff?.doctor?.price || 500);
        }
        if (staffList.includes('Nurse')) {
            supportingStaffCharge += Number(amb.supportStaff?.nurse?.price || 300);
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


// 1. GET AMBULANCE SLOTS (User Side Date-wise Slot Picker)
// Endpoint: GET /user/ambulance/slots/:ambulanceId?date=YYYY-MM-DD&serviceType=Medical Ambulance
const getAmbulanceSlots = async (req, res) => {
    try {
        const { ambulanceId } = req.params;
        const { date, serviceType } = req.query;

        if (!ambulanceId || !date) {
            return res.status(400).json({ 
                success: false, 
                message: "ambulanceId and date (YYYY-MM-DD) query parameters are required." 
            });
        }

        const Ambulance = require('../../../models/Ambulance');
        const Availability = require('../../../models/Availability');
        const Booking = require('../../../models/AmbulanceBooking');
        const { generateAmbulanceSlots } = require('../../../utils/timeSlotHelper');

        const ambulance = await Ambulance.findById(ambulanceId).select('name vehicleNumber vehicleType isOnline isActive');
        if (!ambulance || !ambulance.isActive) {
            return res.status(404).json({ success: false, message: "Ambulance not found or inactive." });
        }

        // 1. Fetch Driver's Shift Configuration
        const availabilityConfig = await Availability.findOne({ vendorId: ambulanceId, vendorType: 'Ambulance' });

        // 2. Fetch Confirmed / In-Transit Bookings for that specific date
        const startOfDay = moment(date).startOf('day').toDate();
        const endOfDay = moment(date).endOf('day').toDate();

        const bookedTrips = await Booking.find({
            ambulanceId: ambulance._id,
            status: { $in: ['Searching', 'Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] },
            scheduledAt: { $gte: startOfDay, $lte: endOfDay }
        }).select('scheduledAt scheduledTime status bookingId').lean();

        // 3. Generate Filtered Slots
        const slotResult = generateAmbulanceSlots(availabilityConfig, bookedTrips, date);

        res.json({
            success: true,
            date,
            ambulance: {
                id: ambulance._id,
                name: ambulance.name,
                vehicleNumber: ambulance.vehicleNumber,
                vehicleType: ambulance.vehicleType,
                isOnline: ambulance.isOnline
            },
            isClosed: slotResult.isClosed,
            reason: slotResult.reason || null,
            totalSlots: slotResult.slots.length,
            availableSlotsCount: slotResult.slots.filter(s => s.isAvailable).length,
            slots: slotResult.slots
        });

    } catch (error) {
        console.error("Get Ambulance Slots Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
//  UNIVERSAL CONFIRM BOOKING (Updated with Real Valuation & No Accidental OTP)
// 2. CONFIRM AMBULANCE BOOKING (With Real-Time Slot Collision Lock)
// Endpoint: POST /user/ambulance/confirm-booking
const confirmAmbulanceBooking = async (req, res) => {
    try {
        let { 
            ambulanceId, 
            serviceType, 
            triageLevel, 
            pickupLocation, 
            patientDetails, 
            paymentMethod,
            scheduledDate,
            scheduledTime,
            pickupHospitalId,
            hospitalId,
            supportStaffSelected,
            policeRequired,
            fireRequired,
            couponCode,
            staffType
        } = req.body;

        const userId = req.user.id;
        const Booking = require('../../../models/AmbulanceBooking');
        const Ambulance = require('../../../models/Ambulance');
        const Appointment = require('../../../models/Appointment');
        const crypto = require('crypto');

        // 🚨 MULTIPART STRINGIFIED JSON PARSING SAFETY
        if (typeof patientDetails === 'string') {
            try { patientDetails = JSON.parse(patientDetails); } catch (e) {}
        }
        if (typeof pickupLocation === 'string') {
            try { pickupLocation = JSON.parse(pickupLocation); } catch (e) {}
        }
        if (typeof supportStaffSelected === 'string') {
            try { supportStaffSelected = JSON.parse(supportStaffSelected); } catch (e) {}
        }

        const generateCaseRef = (type) => {
            const prefix = type === 'Accident emergency' ? 'ACC' : (type === 'Referral Ambulance' ? 'REF' : 'MED');
            const randomHex = crypto.randomBytes(2).toString('hex').toUpperCase();
            return `HK-${new Date().getFullYear()}-${prefix}-${Date.now().toString().slice(-4)}${randomHex}`;
        };

        // =========================================================================
        // CASE 1: ACCIDENTAL EMERGENCY (100% Free Instant Broadcast)
        // =========================================================================
        if (serviceType === 'Accident emergency') {
            const tempBookingId = `HK-ACC-${Date.now().toString().slice(-6)}`;
            const freshOtp = Math.floor(100000 + Math.random() * 900000).toString();

            const newBooking = await Booking.create({
                bookingId: tempBookingId,
                caseReference: generateCaseRef('Accident emergency'),
                userId,
                ambulanceId: null, // Broadcast pool
                hospitalId: hospitalId || null,
                serviceType: 'Accident emergency',
                triageLevel: 'Emergency',
                pickupLocation: pickupLocation || { address: "Spot", lat: 30.7046, lng: 76.7179 },
                patientDetails: patientDetails || { name: "Accident Victim" },
                additionalSupport: {
                    policeRequired: policeRequired === 'true' || policeRequired === true,
                    fireRequired: fireRequired === 'true' || fireRequired === true
                },
                pricing: {
                    originalAmbulanceCharge: 2000,
                    subtotal: 2000,
                    discount: 0,
                    total: 0 // Free
                },
                isFreeCase: true,
                paymentStatus: 'Paid',
                paymentMethod: 'Online',
                status: 'Searching',
                otp: freshOtp,
                trackingTimeline: [{
                    status: 'Searching',
                    timestamp: new Date(),
                    note: "1-Click Accidental Emergency SOS dispatched to nearby ambulances."
                }]
            });

            return res.status(201).json({
                success: true,
                message: "Accident Emergency broadcast sent to all nearby ambulances.",
                booking: newBooking
            });
        }

        // =========================================================================
        // CASE 2: MEDICAL & REFERRAL AMBULANCE (Slot Lock & Fare Calculation)
        // =========================================================================
        if (!ambulanceId) {
            return res.status(400).json({ success: false, message: "Please select an ambulance driver." });
        }

        if (!scheduledDate || !scheduledTime) {
            return res.status(400).json({ 
                success: false, 
                message: "Scheduled Date (YYYY-MM-DD) and Scheduled Time Slot are mandatory for Medical and Referral transfers." 
            });
        }

        const targetAmbulance = await Ambulance.findById(ambulanceId);
        if (!targetAmbulance || !targetAmbulance.isActive || !targetAmbulance.isOnline) {
            return res.status(400).json({ 
                success: false, 
                errorType: "DRIVER_OFFLINE",
                message: "The selected ambulance driver is currently offline. Please pick another driver." 
            });
        }

        // 1. Calculate Server-Verified Fare & Subscription Benefits
        const verifiedFare = await getFinalFare({
            ambulanceId,
            serviceType: serviceType || 'Medical Ambulance',
            staffType: staffType || (supportStaffSelected?.doctor ? ['Doctor'] : (supportStaffSelected?.nurse ? ['Nurse'] : [])),
            couponCode,
            pickupLocation,
            hospitalId,
            pickupHospitalId
        }, userId);

        // 2. Validate COD Permission
        const isCod = (paymentMethod === 'COD');
        if (isCod) {
            const isCodAllowed = await isCodEnabled('Ambulance', userId);
            if (!isCodAllowed && verifiedFare.total > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Cash on Delivery is currently disabled for Ambulance rides. Please pay online."
                });
            }
        }

        // 3. Construct 2-Hour Slot Timestamp
        const timeSlotStartStr = scheduledTime.includes(' - ') ? scheduledTime.split(' - ')[0] : scheduledTime;
        const bookingStart = moment(`${scheduledDate} ${timeSlotStartStr}`, ["YYYY-MM-DD hh:mm A", "YYYY-MM-DD HH:mm"]);
        if (!bookingStart.isValid()) {
            return res.status(400).json({ success: false, message: "Invalid scheduled date or time format." });
        }
        const bookingEnd = bookingStart.clone().add(120, 'minutes');

        // 4. Strict Slot Overlap Check
        const hasConflict = await Booking.findOne({
            ambulanceId: targetAmbulance._id,
            status: { $in: ['Searching', 'Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] },
            scheduledAt: {
                $gte: bookingStart.clone().subtract(119, 'minutes').toDate(),
                $lte: bookingEnd.clone().add(119, 'minutes').toDate()
            }
        });

        if (hasConflict) {
            return res.status(400).json({
                success: false,
                errorType: "SLOT_ALREADY_BOOKED",
                message: `This time slot (${scheduledTime}) is already booked for ${targetAmbulance.name}. Please select another slot or driver.`
            });
        }

        const tempBookingId = `HK-AMB-${Date.now().toString().slice(-6)}`;
        const freshOtp = Math.floor(100000 + Math.random() * 900000).toString();

        let referralSlipUrl = null;
        if (req.files?.referralCard && req.files.referralCard[0]) {
            referralSlipUrl = `/uploads/ambulances/${req.files.referralCard[0].filename}`;
        }

        // 5. Create Razorpay Order if Online & Payable > 0
        let rzpOrder = null;
        if (!isCod && verifiedFare.total > 0) {
            rzpOrder = await createRazorpayOrder(verifiedFare.total, `receipt_${tempBookingId}`);
        }

        const booking = await Booking.create({
            bookingId: tempBookingId,
            caseReference: generateCaseRef(serviceType || 'Medical Ambulance'),
            userId,
            ambulanceId: targetAmbulance._id,
            hospitalId: hospitalId || null,
            pickupHospitalId: pickupHospitalId || null,
            serviceType: serviceType || 'Medical Ambulance',
            triageLevel: triageLevel || 'Routine',
            pickupLocation: pickupLocation || {},
            patientDetails: {
                ...(patientDetails || {}),
                referralCard: referralSlipUrl
            },
            supportStaffSelected: supportStaffSelected || { nurse: false, doctor: false },
            scheduledAt: bookingStart.toDate(),
            scheduledTime: scheduledTime,
            pricing: {
                ambulanceCharge: verifiedFare.ambulanceCharge,
                originalAmbulanceCharge: verifiedFare.originalAmbulanceCharge,
                supportingStaffCharge: verifiedFare.supportingStaffCharge,
                subtotal: verifiedFare.subtotal,
                discount: verifiedFare.discount,
                total: verifiedFare.total
            },
            couponDetails: verifiedFare.couponId ? {
                couponId: verifiedFare.couponId,
                couponCode: verifiedFare.finalCouponCode,
                discountValue: verifiedFare.discount
            } : undefined,
            subscriptionDetails: {
                isSubscriptionApplied: verifiedFare.isSubscriptionApplied,
                userSubscriptionId: verifiedFare.userSubscriptionId,
                planName: verifiedFare.planName
            },
            paymentMethod: paymentMethod || 'COD',
            paymentStatus: (isCod || verifiedFare.total === 0) ? 'Paid' : 'Pending',
            status: 'Confirmed',
            otp: freshOtp,
            trackingTimeline: [{
                status: 'Confirmed',
                timestamp: new Date(),
                note: `Booking scheduled for ${scheduledDate} (${scheduledTime}) with driver ${targetAmbulance.name}.`
            }]
        });

        // 6. Deduct Subscription Benefit & Record Coupon Usage
        if (verifiedFare.isSubscriptionApplied) {
            await deductBenefitCount(userId, 'freeAmbulanceTripsCount');
        }

        if (verifiedFare.couponId) {
            await Coupon.findByIdAndUpdate(verifiedFare.couponId, {
                $push: { usedBy: { userId, usageCount: 1 } }
            });
        }

        // 7. Auto-Sync Destination Hospital Pre-Admission
        if (booking.hospitalId) {
            const hospitalBookingId = `HKH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
            await Appointment.create({
                userId,
                hospitalId: booking.hospitalId,
                ambulanceId: targetAmbulance._id,
                bookingType: 'Admission',
                bedBookingType: 'General-Bed',
                status: 'Hospital-Pending',
                bookingId: hospitalBookingId,
                transactionId: booking.bookingId,
                triageLevel: triageLevel || 'Routine',
                patients: [{
                    patientName: patientDetails?.name || "Patient",
                    patientAge: patientDetails?.age || 30,
                    gender: patientDetails?.gender || "Male",
                    reasonForVisit: patientDetails?.emergencyDescription || `${serviceType} Transfer`
                }],
                startDate: bookingStart.toDate(),
                pricingBreakdown: { baseFee: 0, subtotal: 0 },
                totalAmount: 0
            });
        }

        // 8. Notify Driver
        await sendPushNotification(
            targetAmbulance._id,
            'ambulance',
            `New ${serviceType} Scheduled!`,
            `Booking #${booking.bookingId} reserved for ${scheduledDate} (${scheduledTime}).`,
            { bookingId: booking._id.toString(), type: 'new_scheduled_ambulance_booking' }
        );

        // Response for Online Payment
        if (!isCod && verifiedFare.total > 0 && rzpOrder) {
            return res.status(201).json({
                success: true,
                message: "Razorpay order created. Please complete payment.",
                requiresPayment: true,
                key_id: process.env.RAZORPAY_KEY_ID,
                amount: rzpOrder.amount,
                razorpayOrderId: rzpOrder.id,
                bookingId: tempBookingId,
                booking
            });
        }

        // Response for COD / Free Subscription
        res.status(201).json({
            success: true,
            requiresPayment: false,
            message: "Ambulance booked successfully for the selected slot!",
            booking
        });

    } catch (error) {
        console.error("Confirm Ambulance Booking Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// INITIATE PAYMENT AFTER DRIVER ACCEPTS
// endpoint: POST /user/ambulance/initiate-payment/:bookingId
const initiateAmbulancePaymentAfterAcceptance = async (req, res) => {
    try {
        const { bookingId } = req.params;

        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = {
            $or: [
                { _id: isObjectId ? new mongoose.Types.ObjectId(bookingId) : new mongoose.Types.ObjectId() },
                { bookingId: String(bookingId).trim() }
            ],
            userId: req.user.id
        };

        const booking = await Booking.findOne(query);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        if (booking.status !== 'Confirmed') {
            return res.status(400).json({ success: false, message: "Cannot pay yet. Driver has not accepted the ride request." });
        }

        if (booking.paymentStatus === 'Paid') {
            return res.status(400).json({ success: false, message: "Payment has already been completed for this booking." });
        }

        const rzpOrder = await createRazorpayOrder(booking.pricing.total, `receipt_${booking.bookingId}`);
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
        console.error("Initiate Payment Error:", error);
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




// 3. GET BOOKING STATUS (Security Isolation: Owner Verified)
// Endpoint: GET /user/ambulance/track/:id
const getBookingStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id; // Logged-in patient user ID

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            $and: [
                {
                    $or: [
                        { _id: isObjectId ? new mongoose.Types.ObjectId(id) : new mongoose.Types.ObjectId() },
                        { bookingId: String(id).trim() }
                    ]
                },
                { userId: new mongoose.Types.ObjectId(userId) } // 🚨 SECURITY FIX: Prevents unauthorized patient data leakage
            ]
        };

        const booking = await Booking.findOne(query)
            .populate('ambulanceId', 'name phone vehicleNumber vehicleType location driverInfo profilePic averageRating')
            .populate('hospitalId', 'name address location phone hospitalImage')
            .populate('pickupHospitalId', 'name address location phone hospitalImage')
            .lean();
        
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found or access denied." });
        }

        res.json({ success: true, data: booking });
    } catch (error) { 
        console.error("Get Booking Status Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};
// 2. GET USER NUMBERS (Sanitized & De-duplicated)
// Endpoint: GET /user/ambulance/my-numbers
const getUserNumbers = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('phone emergencyContact').lean();
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        let rawNumbers = [];
        if (user.phone) rawNumbers.push(String(user.phone).trim());
        
        if (user.emergencyContact && Array.isArray(user.emergencyContact)) {
            user.emergencyContact.forEach(c => {
                if (c && c.phone) rawNumbers.push(String(c.phone).trim());
            });
        }

        // 🚨 SANITIZE: Remove null/empty and eliminate duplicate phone numbers
        const cleanNumbers = [...new Set(rawNumbers.filter(p => p && p.length >= 10))];

        res.json({ 
            success: true, 
            numbers: cleanNumbers 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// --- 3. UPLOAD INCIDENT PHOTO (Figma Screen: Capture Incident Photo) ---
const uploadIncidentPhoto = async (req, res) => {
    try {
        const { bookingId } = req.params;
        
        const photoPath = req.files?.incidentPhoto ? 
            `/uploads/ambulances/${req.files.incidentPhoto[0].filename}` : null;

        if (!photoPath) {
            return res.status(400).json({ success: false, message: "No photo uploaded. Field name must be 'incidentPhoto'." });
        }

        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = isObjectId ? { _id: bookingId } : { bookingId: String(bookingId).trim() };

        const booking = await Booking.findOneAndUpdate(
            query,
            { $set: { 'patientDetails.incidentPhoto': photoPath } },
            { new: true }
        );

        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        res.json({ success: true, message: "Incident photo saved successfully.", data: booking });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 1. GET LIVE TRACKING DATA (Dynamic Target: Pickup Spot vs Hospital Destination)
// Endpoint: GET /user/ambulance/live-track/:id
// =========================================================================
const getLiveTracking = async (req, res) => {
    try {
        const { id } = req.params;
        const isObjectId = mongoose.isValidObjectId(id);
        const query = isObjectId ? { _id: id } : { bookingId: String(id).trim() };

        const booking = await Booking.findOne(query)
            .populate({
                path: 'ambulanceId',
                select: 'name phone vehicleNumber vehicleType location driverInfo profilePic averageRating totalReviews'
            })
            .populate('hospitalId', 'name address location phone hospitalImage')
            .populate('pickupHospitalId', 'name address location phone');

        if (!booking) return res.status(404).json({ success: false, message: "Booking record not found." });

        const driver = booking.ambulanceId;

        let realTripsCount = 0;
        if (driver?._id) {
            realTripsCount = await Booking.countDocuments({
                ambulanceId: driver._id,
                status: 'Delivered'
            });
        }

        let dynamicEta = "Arriving";
        let targetLat = null;
        let targetLng = null;

        // 🚨 CRITICAL FIX: Determine navigation destination based on ride lifecycle
        if (booking.status === 'Picked-Up' || booking.status === 'En-Route') {
            // Stage B: Patient onboarded ➔ Distance is to Destination Hospital
            targetLat = booking.hospitalId?.location?.lat;
            targetLng = booking.hospitalId?.location?.lng;
        } else {
            // Stage A: Driver going to pick up patient ➔ Distance is to Pickup Spot
            targetLat = booking.pickupLocation?.lat;
            targetLng = booking.pickupLocation?.lng;
        }

        if (driver?.location?.lat && targetLat) {
            const distance = await getDistance(
                driver.location.lat,
                driver.location.lng,
                targetLat,
                targetLng
            );

            if (distance <= 0.3) {
                dynamicEta = (booking.status === 'Picked-Up' || booking.status === 'En-Route') 
                    ? "Arriving at Hospital Gate" 
                    : "Arrived at Pickup Spot";
            } else {
                const estimatedMinutes = Math.max(1, Math.round(distance * 3));
                dynamicEta = `${estimatedMinutes} mins`;
            }
        }

        const trackingData = {
            status: booking.status,
            otp: booking.otp,
            serviceType: booking.serviceType,
            triageLevel: booking.triageLevel,
            eta: dynamicEta,
            isNavigatingToHospital: (booking.status === 'Picked-Up' || booking.status === 'En-Route'),
            driver: {
                name: driver?.driverInfo?.fullName || driver?.name || "Assigned Driver",
                phone: driver?.phone || "N/A",
                rating: driver?.averageRating || 5.0,
                totalReviews: driver?.totalReviews || 0,
                trips: realTripsCount > 0 ? `${realTripsCount} Trips` : "Verified Driver",
                profilePic: driver?.profilePic || null
            },
            vehicle: {
                plateNumber: driver?.vehicleNumber || "Verified Vehicle",
                type: driver?.vehicleType || "Ambulance"
            },
            driverLocation: driver?.location || { lat: 0, lng: 0 },
            pickupLocation: booking.pickupLocation,
            pickupHospital: booking.pickupHospitalId || null,
            destinationHospital: booking.hospitalId || null,
            timeline: booking.trackingTimeline || []
        };

        res.json({ success: true, data: trackingData });
    } catch (error) { 
        console.error("Live Tracking Error:", error);
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

        // 3. Cancel Destination Hospital Pre-Admission
        if (booking.bookingId) {
            try {
                await Appointment.findOneAndUpdate(
                    { transactionId: booking.bookingId },
                    { $set: { status: 'Cancelled-By-User', 'tracking.status': 'Cancelled' } }
                );
            } catch (e) {}
        }

        await booking.save();

        // 4. 24-Hours Accidental Auto-Ban Engine (2 cancellations = 24h ban)
        let isUserBannedNow = false;
        let banMessage = "";

        if (isAccidental) {
            const now = new Date();
            const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

            const effectiveStartDate = (user.unbannedAt && new Date(user.unbannedAt) > last24Hours)
                ? new Date(user.unbannedAt)
                : last24Hours;

            const cancellationsIn24Hrs = await Booking.countDocuments({
                userId: user._id,
                serviceType: 'Accident emergency',
                status: 'Cancelled',
                updatedAt: { $gte: effectiveStartDate }
            });

            if (cancellationsIn24Hrs >= 2) {
                isUserBannedNow = true;
                user.isActive = false;
                user.isBanned = true;
                user.banReason = "Account suspended: 2 accidental emergency bookings were cancelled within 24 hours.";
                user.token = null;
                await user.save();

                banMessage = "⚠️ Your account has been suspended for cancelling 2 accidental emergency bookings in 24 hours. Please submit an Unban Request from the app.";
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


// 2. SHORT REGISTRATION & ACCIDENTAL SOS (With Multi-Driver Siren Broadcast)
// Endpoint: POST /user/ambulance/accidental/short-book
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
        const pLat = Number(pickupLat || 30.7046);
        const pLng = Number(pickupLng || 76.7179);

        // 1. Check free online drivers within 15km
        const busyAmbs = await Booking.find({
            status: { $in: ['Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] }
        }).select('ambulanceId').lean();
        const busyIds = busyAmbs.filter(b => b.ambulanceId).map(b => b.ambulanceId.toString());

        const onlineDrivers = await Ambulance.find({
            _id: { $nin: busyIds },
            isActive: true,
            profileStatus: 'Approved',
            isOnline: true,
            availableForEmergency: true
        }).lean();

        // Distance filter (15km radius)
        const nearbyDrivers = [];
        for (let driver of onlineDrivers) {
            if (driver.location?.lat && driver.location?.lng) {
                const dist = await getDistance(pLat, pLng, driver.location.lat, driver.location.lng);
                if (dist <= 15) {
                    nearbyDrivers.push(driver);
                }
            }
        }

        // ❌ 0-Availability Helpline Fallback
        if (nearbyDrivers.length === 0) {
            return res.status(200).json({
                success: false,
                isServiceAvailable: false,
                canBook: false,
                message: "No partner ambulances are currently available within your radius. Please dial Government 108 or 112 emergency helpline immediately.",
                emergencyHelplines: getEmergencyHelplinesData()
            });
        }

        // 2. User resolution
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
                    message: "Free emergency booking limit reached for unverified number. Please verify your phone via OTP."
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
                lat: pLat,
                lng: pLng
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
                note: `Accidental 1-Click SOS triggered. Broadcasted to ${nearbyDrivers.length} nearby ambulances.`
            }]
        });

        // 🚨 BROADCAST LOUD SIREN PUSH NOTIFICATIONS TO ALL NEARBY DRIVERS
        for (let driver of nearbyDrivers) {
            try {
                await sendPushNotification(
                    driver._id,
                    'ambulance',
                    "🚨 URGENT ACCIDENTAL SOS NEAR YOU!",
                    `New emergency pickup at ${pickupAddress || 'Accident Spot'}. Tap to claim immediately!`,
                    { bookingId: booking._id.toString(), type: 'emergency_sos_broadcast' }
                );
            } catch (e) {}
        }

        // Notify Admin Control Desk
        try {
            await notifyAdminsAndVendor(
                null,
                'admin',
                "🚨 CRITICAL: Accidental SOS Dispatched!",
                `Accident reported at ${pickupAddress || 'Spot'}. Alerted ${nearbyDrivers.length} nearby drivers.`,
                { bookingId: booking._id.toString(), type: 'emergency_sos_broadcast' }
            );
        } catch (e) {}

        res.status(201).json({
            success: true,
            isServiceAvailable: true,
            canBook: true,
            message: `Accidental SOS broadcasted to ${nearbyDrivers.length} nearby ambulances!`,
            token,
            isNewUser,
            bookingId: tempBookingId,
            timeoutInSeconds: 60,
            booking
        });

    } catch (error) {
        console.error("Short Accidental Booking Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// 🚀 1-MINUTE ACCIDENTAL SOS ESCALATION & GOVT HELPLINE FALLBACK
// Endpoint: POST /user/ambulance/sos/escalate/:bookingId
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
    getAmbulanceSlots,
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