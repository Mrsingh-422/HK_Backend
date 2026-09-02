const Ambulance = require('../../../models/Ambulance');
const Booking = require('../../../models/AmbulanceBooking');
const Hospital = require('../../../models/Hospital');
const User = require('../../../models/User');
const Coupon = require('../../../models/Coupon');
const Review = require('../../../models/Review');
const crypto = require('crypto');
const Wallet = require('../../../models/Wallet');
const mongoose = require('mongoose');
const { getDistance } = require('../../../utils/helpers');
const { sendPushNotification,notifyAdminsAndVendor } = require('../../../utils/notification');
const { createRazorpayOrder, verifyRazorpaySignature,fetchAndMapRazorpayPayment } = require('../../../utils/razorpay'); // 👈 Razorpay Helpers Imported
const { checkAndApplyBenefit, deductBenefitCount,refundBenefitCount } = require('../../../utils/subscriptionBenefitHelper');
const { processCancellationRefund } = require('../../../utils/policyHelper');
const { isCodEnabled } = require('../../../utils/policyHelper');
const { verifyFirebasePhoneToken } = require('../../../utils/firebaseAuthHelper');
const UserSubscription = require('../../../models/UserSubscription');
const Appointment = require('../../../models/Appointment');

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


// --- 3. FIND NEAREST AMBULANCES (POST with Distance) ---
// Figma Screen 43
const getNearestAmbulances = async (req, res) => {
    try {
        const { lat, lng, serviceType, vehicleType } = req.body; 

        // Strictly filters: Only ACTIVE (isActive: true) and APPROVED ambulances (Offline ones included)
        let query = { isActive: true, profileStatus: 'Approved' };
        if (vehicleType) query.vehicleType = vehicleType;

        const ambulances = await Ambulance.find(query);

        const data = await Promise.all(ambulances.map(async (amb) => {
            const distance = await getDistance(lat, lng, amb.location.lat, amb.location.lng);
            
            const reviews = await Review.find({ 
                targetId: amb._id, 
                targetType: 'Ambulance' 
            }).select('rating').lean();

            let averageRating = 4.8; 
            if (reviews.length > 0) {
                const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
                averageRating = Number((totalRating / reviews.length).toFixed(1)); 
            }

            let displayPrice = amb.pricing?.fixedPrice || 2000;
            let isFree = false;

            if (serviceType === 'Accident emergency') {
                displayPrice = 0;
                isFree = true;
            } else if (serviceType === 'Medical Ambulance' && amb.freeServices.emergency) {
                displayPrice = 0;
                isFree = true;
            } else if (serviceType === 'Referral Ambulance' && amb.freeServices.referral) {
                displayPrice = 0;
                isFree = true;
            }

            return {
                ...amb._doc,
                distance: `${distance} km`,
                rawDistance: distance,
                displayPrice: displayPrice, 
                isFreeCase: isFree,
                eta: `${Math.round(distance * 3)} mins`,
                rating: averageRating,       
                totalReviews: reviews.length,
                isOnline: amb.isOnline ?? true // Passes isOnline state to list response
            };
        }));

        data.sort((a, b) => a.rawDistance - b.rawDistance);
        res.json({ success: true, count: data.length, data });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
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
    let { ambulanceId, serviceType, staffType, couponCode } = params;
    
    const cleanCoupon = (couponCode && couponCode !== "null" && couponCode !== "undefined") ? couponCode.trim().toUpperCase() : null;

    const amb = await Ambulance.findById(ambulanceId);
    if (!amb) throw new Error("Ambulance not found");

    const isFree = (serviceType === 'Accident emergency');
    let ambulanceCharge = isFree ? 0 : (amb.pricing?.fixedPrice || 2000);
    
    let originalAmbulanceCharge = ambulanceCharge; // 👈 Save actual ambulance charge
    let isSubscriptionApplied = false;
    let planName = "";
    let userSubscriptionId = null;

    // 🚨 SUBSCRIPTION CHECK: Only apply benefits logic if ride is NOT universally free SOS
    if (!isFree) {
        const { checkAndApplyBenefit } = require('../../../utils/subscriptionBenefitHelper');
        const ambBenefit = await checkAndApplyBenefit(userId, 'freeAmbulanceTripsCount', ambulanceCharge);
        
        if (ambBenefit.isApplied) {
            ambulanceCharge = 0; // Value is waived
            isSubscriptionApplied = true;

            const UserSubscription = require('../../../models/UserSubscription');
            const activeSub = await UserSubscription.findOne({
                userId,
                status: 'Active',
                endDate: { $gt: new Date() }
            }).populate('planId', 'name');

            if (activeSub) {
                planName = activeSub.planId?.name || "Premium Care Plan";
                userSubscriptionId = activeSub._id;
            }
        }
    }

    let supportingStaffCharge = 0;
    if (!isFree && staffType) {
        let staffList = Array.isArray(staffType) ? staffType : (typeof staffType === 'string' ? staffType.split(',') : []);
        staffList = staffList.map(s => s.trim());

        if (staffList.includes('Doctor')) {
            supportingStaffCharge += (amb.supportStaff?.doctor?.price || 0);
        }
        if (staffList.includes('Nurse')) {
            supportingStaffCharge += (amb.supportStaff?.nurse?.price || 0);
        }
    }

    let subtotal = ambulanceCharge + supportingStaffCharge;
    let discount = 0;
    let couponId = null;
    let finalCouponCode = null;

    if (cleanCoupon && !isFree) {
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
    }

    return { 
        ambulanceCharge, 
        originalAmbulanceCharge, // 👈 Original calculated pricing in return block
        supportingStaffCharge, 
        subtotal, 
        discount, 
        total: subtotal - discount, 
        isFree, 
        couponId, 
        finalCouponCode,
        isSubscriptionApplied, // 👈 Sets boolean flag
        userSubscriptionId,
        planName
    };
};

// --- 1. CHECKOUT API (Updated with COD Check) ---
const calculateAmbulanceFare = async (req, res) => {
    try {
        const isCodAllowed = await isCodEnabled('Ambulance');
        const fare = await getFinalFare(req.body, req.user.id); // req.body contains all booking keys
        
        res.json({ 
            success: true, 
            isCodAvailable: isCodAllowed, // 👈 Dynamic indicator added
            data: fare 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. BOOKING API (Same Keys + Future Razorpay Support) ---
// --- UNIVERSAL CONFIRM BOOKING (Updated with COD and Subscription Check) ---
const confirmAmbulanceBooking = async (req, res) => {
    try {
        let body = { ...req.body };
        
        // 1. Flutter/Form-data Parsing
        if (typeof body.pricing === 'string') {
            try { body.pricing = JSON.parse(body.pricing); } catch (e) {}
        }
        
        if (typeof body.couponDetails === 'string') {
            try { 
                const parsedCoupon = JSON.parse(body.couponDetails);
                body.couponCode = parsedCoupon.couponCode;
            } catch (e) {}
        }

        const { 
            ambulanceId, hospitalId, pickupHospitalId, serviceType, 
            triageLevel, patientDetails, staffType, paymentId,
            scheduledDate, appointmentTime,
            reason,              
            referralReason,      
            incidentDescription, 
            policeRequired,      
            fireRequired         
        } = body;

        if (!ambulanceId) {
            return res.status(400).json({ success: false, message: "Target Ambulance ID is required." });
        }

        const targetAmbulance = await Ambulance.findById(ambulanceId);
        if (!targetAmbulance) {
            return res.status(404).json({ success: false, message: "Ambulance not found." });
        }

        if (targetAmbulance.isOnline === false || targetAmbulance.isActive === false) {
            return res.status(400).json({
                success: false,
                message: "Booking Blocked: Ambulance is currently offline or inactive."
            });
        }

        const activePaymentMethod = body.paymentMethod || "Online";

        if (activePaymentMethod === 'COD') {
            const isCodAllowed = await isCodEnabled('Ambulance');
            if (!isCodAllowed) {
                return res.status(400).json({
                    success: false,
                    message: "Cash on Delivery is currently disabled for Ambulance bookings. Please pay online."
                });
            }
        }

        // 3. Calculate Fare using helper
        const fare = await getFinalFare(body, req.user.id); 

        // 4. Map supportStaffSelected Booleans
        let staffList = staffType ? (typeof staffType === 'string' ? staffType.split(',') : staffType) : [];
        staffList = staffList.map(s => s.trim());
        const supportStaffSelected = {
            doctor: staffList.includes('Doctor'),
            nurse: staffList.includes('Nurse')
        };

        // 5. Patient Details Parsing
        let parsedDetails = {};
        if (typeof patientDetails === 'string') {
            try { parsedDetails = JSON.parse(patientDetails || '{}'); } catch (e) { parsedDetails = {}; }
        } else { parsedDetails = patientDetails || {}; }

        // 6. Handle Images
        let referralCardPath = req.files?.referralCard ? `/uploads/ambulances/${req.files.referralCard[0].filename}` : null;
        let incidentPhotoPath = req.files?.incidentPhoto ? `/uploads/ambulances/${req.files.incidentPhoto[0].filename}` : null;

        const finalReason = reason || referralReason || incidentDescription || parsedDetails.emergencyDescription || "";

        // 7. Parse Pickup Location
        let finalPickupLocation = { address: "Pickup Location", lat: 30.7046, lng: 76.7179 };

        if (body['pickupLocation[address]']) {
            finalPickupLocation = {
                address: body['pickupLocation[address]'],
                lat: Number(body['pickupLocation[lat]'] || 30.7046),
                lng: Number(body['pickupLocation[lng]'] || 76.7179)
            };
        } 
        else if (body.pickupAddress || body.pickupLocationAddress) {
            finalPickupLocation = {
                address: body.pickupAddress || body.pickupLocationAddress,
                lat: Number(body.pickupLat || body.pickupLocationLat || 30.7046),
                lng: Number(body.pickupLng || body.pickupLocationLng || 76.7179)
            };
        }
        else if (body.pickupLocation) {
            if (typeof body.pickupLocation === 'string') {
                try {
                    const parsed = JSON.parse(body.pickupLocation);
                    if (parsed && typeof parsed === 'object') {
                        finalPickupLocation = {
                            address: parsed.address || parsed.pickupAddress || "Pickup Location",
                            lat: Number(parsed.lat || parsed.pickupLat || 30.7046),
                            lng: Number(parsed.lng || parsed.pickupLng || 76.7179)
                        };
                    }
                } catch (e) {
                    finalPickupLocation = {
                        address: body.pickupLocation, 
                        lat: Number(body.lat || body.pickupLat || 30.7046),
                        lng: Number(body.lng || body.pickupLng || 76.7179)
                    };
                }
            } else if (typeof body.pickupLocation === 'object') {
                finalPickupLocation = {
                    address: body.pickupLocation.address || body.pickupLocation.pickupAddress || "Pickup Location",
                    lat: Number(body.pickupLocation.lat || 30.7046),
                    lng: Number(body.pickupLocation.lng || 76.7179)
                };
            }
        }

        const tempBookingId = `HK-BOK-${Date.now().toString().slice(-6)}`;
        let rzpOrder = null;

        if (!fare.isFree && activePaymentMethod !== 'COD' && fare.total > 0) {
            rzpOrder = await createRazorpayOrder(fare.total, `receipt_${tempBookingId}`);
        }

        const initialStatus = activePaymentMethod === 'COD' || fare.isFree ? 'Confirmed' : 'Searching';

        // 🎲 8. Real 6-Digit Pickup OTP Generated
        const dynamicPickupOtp = Math.floor(100000 + Math.random() * 900000).toString();

        // 9. Save Booking Record
        const booking = await Booking.create({
            bookingId: tempBookingId,
            caseReference: generateCaseRef(serviceType || 'Medical Ambulance'),
            userId: req.user.id,
            ambulanceId,
            hospitalId: hospitalId && mongoose.isValidObjectId(hospitalId) ? hospitalId : null,
            pickupHospitalId: pickupHospitalId && mongoose.isValidObjectId(pickupHospitalId) ? pickupHospitalId : null, 
            serviceType: serviceType || 'Medical Ambulance',
            triageLevel: serviceType === 'Accident emergency' ? 'Emergency' : (triageLevel || 'Routine'),
            scheduledAt: scheduledDate ? new Date(scheduledDate) : null,
            scheduledTime: appointmentTime || null,
            supportStaffSelected: supportStaffSelected,
            pickupLocation: finalPickupLocation,
            additionalSupport: {
                policeRequired: policeRequired === 'true' || policeRequired === true,
                fireRequired: fireRequired === 'true' || fireRequired === true
            },
            patientDetails: {
                ...parsedDetails,
                emergencyDescription: finalReason,
                referralReason: finalReason,
                referralCard: referralCardPath || parsedDetails.referralCard,
                incidentPhoto: incidentPhotoPath || parsedDetails.incidentPhoto,
                condition: parsedDetails.condition || "Stable"
            },
            couponDetails: {
                couponId: fare.couponId,
                couponCode: fare.finalCouponCode,
                discountValue: fare.discount
            },
            pricing: {
                ambulanceCharge: fare.ambulanceCharge,
                originalAmbulanceCharge: fare.originalAmbulanceCharge, 
                supportingStaffCharge: fare.supportingStaffCharge,
                subtotal: fare.subtotal,
                discount: fare.discount,
                total: fare.total
            },
            isFreeCase: fare.isFree,
            paymentStatus: fare.isFree ? 'Paid' : 'Pending',
            paymentMethod: activePaymentMethod,
            transactionId: rzpOrder ? rzpOrder.id : null,
            status: initialStatus, 
            otp: dynamicPickupOtp, // 👈 6-Digit Dynamic OTP
            trackingTimeline: [{ 
                status: initialStatus, 
                timestamp: new Date(),
                note: activePaymentMethod === 'COD' ? `Booking request verified under COD.` : `Booking request sent.` 
            }],
            subscriptionDetails: {
                isSubscriptionApplied: fare.isSubscriptionApplied,
                userSubscriptionId: fare.userSubscriptionId,
                planName: fare.planName
            }
        });

        if (initialStatus === 'Confirmed') {
            targetAmbulance.availableForEmergency = false;
            await targetAmbulance.save();
        }

        if (fare.couponId) {
            const coupon = await Coupon.findById(fare.couponId);
            const userIndex = coupon.usedBy.findIndex(u => u.userId && u.userId.toString() === req.user.id.toString());
            if (userIndex > -1) {
                coupon.usedBy[userIndex].usageCount += 1;
            } else {
                coupon.usedBy.push({ userId: req.user.id, usageCount: 1 });
            }
            await coupon.save();
        }

        if (fare.isFree || activePaymentMethod === 'COD' || fare.total === 0) {
            if (serviceType !== 'Accident emergency' && fare.isSubscriptionApplied) {
                await deductBenefitCount(req.user.id, 'freeAmbulanceTripsCount');
            }

            await notifyAdminsAndVendor(
                ambulanceId, 
                'ambulance', 
                "New Ambulance Request! 🚑", 
                `Booking #${tempBookingId} has been placed. Share Pickup OTP: ${dynamicPickupOtp} upon arrival.`,
                { bookingId: booking._id.toString(), type: 'new_booking' }
            );

            return res.status(201).json({ success: true, message: "Booking Request Sent Successfully", booking });
        }

        res.status(201).json({ 
            success: true, 
            message: "Razorpay order created for ambulance. Complete payment to confirm.",
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount, 
            razorpayOrderId: rzpOrder.id,
            appointmentId: booking._id,
            bookingId: tempBookingId
        });

    } catch (error) { 
        console.error("Booking Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};




// 🚨 NEW CONTROLLER: INITIATE PAYMENT AFTER DRIVER ACCEPTS
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

// 🚨 NEW CONTROLLER: VERIFY AMBULANCE PAYMENT SIGNATURE
// endpoint: POST /user/ambulance/verify-payment
const verifyAmbulancePayment = async (req, res) => {
    try {
        const { appointmentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

        const isVerified = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        if (!isVerified) {
            return res.status(400).json({ success: false, message: "Signature verification failed." });
        }

        const booking = await Booking.findById(appointmentId);
        if (!booking) return res.status(404).json({ success: false, message: "Ambulance booking not found." });

        const rzpDetails = await fetchAndMapRazorpayPayment(razorpayPaymentId, razorpaySignature);

        booking.paymentStatus = 'Paid';
        booking.transactionId = razorpayPaymentId;
        booking.paymentDetails = rzpDetails; 
        await booking.save();

        // 🚨 LOGICAL RESOLVE: No deduction here because this was a paid transaction (isFree: false flow)

        res.json({
            success: true,
            message: "Ambulance payment successfully verified!",
            data: booking
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};




// --- 4. CREATE BOOKING (Figma Screen 44/45) ---
const createAmbulanceBooking = async (req, res) => {
    try {
        const { 
            hospitalId, serviceType, triageLevel, 
            patientDetails, ambulanceId, staffType 
        } = req.body;

        const bookingId = `HK-AMB-${Date.now().toString().slice(-6)}`;
        const otp = Math.floor(1000 + Math.random() * 9000).toString();

        const amb = await Ambulance.findById(ambulanceId);
        const ambulanceCharge = amb?.pricing?.fixedPrice || 1200;
        const staffCharge = staffType === 'Doctor' ? 500 : (staffType === 'Nurse' ? 300 : 0);

        const booking = await Booking.create({
            bookingId,
            userId: req.user.id,
            hospitalId,
            ambulanceId,
            serviceType,
            triageLevel,
            patientDetails,
            otp,
            pricing: {
                ambulanceCharge,
                supportingStaffCharge: staffCharge,
                total: ambulanceCharge + staffCharge
            },
            status: 'Searching',
            trackingTimeline: [{ status: 'Searching', timestamp: new Date() }]
        });

        res.status(201).json({ success: true, booking }); // "booking" key matched with your requirement
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// --- 5. GET BOOKING DETAILS (Tracking Screen 37/38) ---
const getBookingStatus = async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id)
            .populate('ambulanceId', 'name phone vehicleNumber vehicleType location driverInfo')
            .populate('hospitalId', 'name address location');
        
        if (!booking) return res.status(404).json({ message: "Booking not found" });
        res.json({ success: true, data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

///////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////// Accidental Ambulance Bookings //////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////


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

// --- 2. CREATE ACCIDENTAL BOOKING (Figma Screen: Accidental Emergency) ---
const createAccidentalBooking = async (req, res) => {
    try {
        const { 
            ambulanceId, 
            pickupLocation, 
            patientRelation, 
            emergencyDescription, 
            phone 
        } = req.body;

        const amb = await Ambulance.findById(ambulanceId);
        if (!amb) return res.status(404).json({ message: "Ambulance not found" });

        const isFree = amb.freeServices.accidental;

        const booking = await Booking.create({
            bookingId: `HK-ACC-${Date.now().toString().slice(-4)}`,
            caseReference: `HK-2026-${Math.floor(10000 + Math.random() * 90000)}`,
            userId: req.user.id,
            ambulanceId: ambulanceId,
            serviceType: 'Accident emergency',
            triageLevel: 'Emergency', 
            patientDetails: {
                relation: patientRelation,
                emergencyDescription: emergencyDescription
            },
            isFreeCase: true,
            pricing: {
                ambulanceCharge: 0,
                supportingStaffCharge: 0,
                total: 0
            },
            status: 'Searching',
            otp: Math.floor(1000 + Math.random() * 9000).toString(),
            trackingTimeline: [{ status: 'Request Accepted by Driver', timestamp: new Date() }]
        });

        // 🚨 Trigger Notification for Accidental emergencies
        await notifyAdminsAndVendor(
            ambulanceId,
            'ambulance',
            "🚨 Emergency Accident Booking!",
            "An accidental emergency booking has been reported. Action required.",
            { bookingId: booking._id.toString(), type: 'emergency_booking' }
        );

        res.status(201).json({ 
            success: true, 
            message: "Searching for Driver...", 
            bookingId: booking._id,
            booking 
        });
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
// Path: controllers/user/Ambulance/AmbulanceBook.js
// Updated: Removed hardcoded "5 mins", "4.8" rating, and "1,240 trips", replaced with live DB aggregations
const getLiveTracking = async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id)
            .populate({
                path: 'ambulanceId',
                select: 'name phone vehicleNumber vehicleType location driverInfo profilePic averageRating totalReviews'
            });

        if (!booking) return res.status(404).json({ message: "Booking not found" });

        const driver = booking.ambulanceId;

        // 🚀 1. DYNAMIC REAL COMPLETED TRIPS COUNT
        let realTripsCount = 0;
        if (driver?._id) {
            realTripsCount = await Booking.countDocuments({
                ambulanceId: driver._id,
                status: 'Delivered'
            });
        }

        // 🚀 2. DYNAMIC LIVE ETA CALCULATION (Distance between ambulance current GPS and pickup spot)
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
                const estimatedMinutes = Math.max(1, Math.round(distance * 3)); // Average 3 mins per KM in city traffic
                dynamicEta = `${estimatedMinutes} mins`;
            }
        }

        const trackingData = {
            status: booking.status,
            otp: booking.otp,
            eta: dynamicEta, // 👈 Real live ETA calculated from GPS
            driver: {
                name: driver?.driverInfo?.fullName || driver?.name || "Assigned Driver",
                phone: driver?.phone || "N/A",
                rating: driver?.averageRating || 5.0, // 👈 Real driver rating from DB
                totalReviews: driver?.totalReviews || 0,
                trips: realTripsCount > 0 ? `${realTripsCount} Trips` : "New Partner", // 👈 Real completed trips from DB
                profilePic: driver?.profilePic || null
            },
            vehicle: {
                plateNumber: driver?.vehicleNumber || "Verified Vehicle",
                type: driver?.vehicleType || "Ambulance"
            },
            location: driver?.location || { lat: 0, lng: 0 },
            timeline: booking.trackingTimeline || []
        };

        res.json({ success: true, data: trackingData });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};


//////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////// Referal Ambulance Bookings /////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////


// --- 1. CREATE REFERRAL BOOKING (Figma Screen 4, 6, 7) ---
const createReferralBooking = async (req, res) => {
    try {
        const { 
            pickupHospitalId, 
            destinationHospitalId, 
            scheduledDate, 
            scheduledTime,
            patientRelation,
            referralReason,
            staffType, 
            ambulanceId,
            triageLevel 
        } = req.body;

        const amb = await Ambulance.findById(ambulanceId);
        if (!amb) return res.status(404).json({ message: "Ambulance not found" });

        const ambulanceCharge = amb.pricing?.fixedPrice || 2000;
        const supportingStaffCharge = staffType === 'Doctor' ? 500 : (staffType === 'Nurse' ? 300 : 0);

        const booking = await Booking.create({
            bookingId: `HK-REF-${Date.now().toString().slice(-4)}`,
            caseReference: `HK-2026-${Math.floor(10000 + Math.random() * 90000)}`,
            userId: req.user.id,
            ambulanceId,
            pickupHospitalId,
            hospitalId: destinationHospitalId,
            serviceType: 'Referral Ambulance',
            triageLevel,
            scheduledAt: new Date(scheduledDate),
            appointmentTime: scheduledTime,
            patientDetails: {
                relation: patientRelation,
                referralReason: referralReason,
                referralCard: req.file ? `/uploads/referrals/${req.file.filename}` : null
            },
            pricing: {
                ambulanceCharge,
                supportingStaffCharge,
                total: ambulanceCharge + supportingStaffCharge
            },
            status: 'Searching'
        });

        // 🚨 Trigger Notification for Referral Bookings
        await notifyAdminsAndVendor(
            ambulanceId,
            'ambulance',
            "New Referral Booking Request",
            "A referral ambulance booking has been scheduled.",
            { bookingId: booking._id.toString(), type: 'referral_booking' }
        );

        res.status(201).json({ success: true, message: "Referral Request Sent", booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////

// --- 1. CANCEL BOOKING (Figma Screen 35/43) ---
const cancelAmbulanceBooking = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const userId = req.user.id;

        // 🚨 1. Dual ID Resolution (Supports Mongo _id as well as custom bookingId e.g. HK-BOK-491029)
        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            $or: [
                { _id: isObjectId ? new mongoose.Types.ObjectId(id) : new mongoose.Types.ObjectId() },
                { bookingId: String(id).trim() }
            ],
            userId: new mongoose.Types.ObjectId(userId)
        };

        const booking = await Booking.findOne(query);
        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: "Ambulance booking not found for this user." 
            });
        }

        // 🚨 2. Guard: Prevent cancelling already completed or cancelled trips
        if (booking.status === 'Cancelled') {
            return res.status(400).json({ 
                success: false, 
                message: "This booking is already cancelled." 
            });
        }
        if (booking.status === 'Delivered') {
            return res.status(400).json({ 
                success: false, 
                message: "Cannot cancel a completed/delivered ambulance trip." 
            });
        }

        // 🚨 3. Dynamic Cancellation Policy Evaluation
        let policyResult = { cancellationFee: 0, refundAmount: 0 };
        try {
            policyResult = await processCancellationRefund(booking, 'Ambulance');
        } catch (policyErr) {
            const totalPaid = booking.pricing?.total || booking.totalAmount || 0;
            policyResult = { cancellationFee: 0, refundAmount: totalPaid };
        }

        const cancellationFee = Number(policyResult.cancellationFee || 0);
        const refundAmount = Number(policyResult.refundAmount || 0);

        // 🚨 4. Update Booking Document
        booking.status = 'Cancelled';
        booking.cancelledBy = 'User';
        booking.cancellationReason = reason || "Cancelled by User";
        
        if (!booking.pricing) booking.pricing = {};
        booking.pricing.cancellationFeeApplied = cancellationFee;
        
        // Update payment status based on fee & previous payment
        if (booking.paymentStatus === 'Paid') {
            booking.paymentStatus = cancellationFee > 0 ? 'Refund-Initiated' : 'Refunded';
        }

        // Safe Timeline Audit
        if (!booking.trackingTimeline) booking.trackingTimeline = [];
        booking.trackingTimeline.push({ 
            status: 'Cancelled', 
            timestamp: new Date(), 
            note: reason ? `Cancelled by User. Reason: ${reason}` : "Cancelled by User." 
        });

        // 🚨 5. Release Ambulance Driver & Send FCM Alert
        if (booking.ambulanceId) {
            await Ambulance.findByIdAndUpdate(booking.ambulanceId, { 
                $set: { availableForEmergency: true } 
            });
            
            try {
                await sendPushNotification(
                    booking.ambulanceId, 
                    'ambulance', 
                    "Ride Cancelled", 
                    "The patient has cancelled this ambulance request.",
                    { bookingId: booking._id.toString(), type: 'booking_cancelled' }
                );
            } catch (notifErr) {
                console.warn("Ambulance push notification warning:", notifErr.message);
            }
        }

        // 🚨 6. DRIVER WALLET SYNC: Credit cancellation fee compensation to Driver's Wallet!
        if (cancellationFee > 0 && booking.ambulanceId) {
            try {
                await creditVendorCompensation(
                    booking.ambulanceId, 
                    'Ambulance', 
                    cancellationFee, 
                    booking.bookingId, 
                    'Cancellation Fee'
                );
            } catch (walletErr) {
                console.warn("Driver wallet compensation sync warning:", walletErr.message);
            }
        }

        // 🚨 7. HOSPITAL PRE-ADMISSION SYNC: Cancel linked Hospital Pre-Admission Record!
        if (booking.bookingId) {
            try {
                const linkedAppointment = await Appointment.findOneAndUpdate(
                    { transactionId: booking.bookingId },
                    { 
                        $set: { 
                            status: 'Cancelled-By-User',
                            'tracking.status': 'Cancelled',
                            'cancellationDetails.reason': reason || "Ambulance transit cancelled by patient.",
                            'cancellationDetails.cancelledAt': new Date()
                        } 
                    },
                    { new: true }
                );

                // Alert destination hospital emergency desk
                if (linkedAppointment && linkedAppointment.hospitalId) {
                    await notifyAdminsAndVendor(
                        linkedAppointment.hospitalId,
                        'hospital',
                        "Emergency Admission Cancelled",
                        `Incoming emergency case for Ambulance #${booking.bookingId} was cancelled by user.`,
                        { appointmentId: linkedAppointment._id.toString(), type: 'admission_cancelled' }
                    );
                }
            } catch (hospErr) {
                console.warn("Hospital pre-admission sync warning:", hospErr.message);
            }
        }

        await booking.save();

        // 🚨 8. Subscription Benefit Refund
        try {
            if (booking.subscriptionDetails?.isSubscriptionApplied && booking.pricing?.ambulanceCharge === 0 && booking.serviceType !== 'Accident emergency') {
                await refundBenefitCount(booking.userId, 'freeAmbulanceTripsCount');
            }
        } catch (subErr) {
            console.warn("Subscription benefit refund warning:", subErr.message);
        }

        // 9. Standardized Success Response
        res.json({ 
            success: true, 
            message: cancellationFee > 0 
                ? `Booking cancelled successfully. A cancellation fee of ₹${cancellationFee} was applied.`
                : "Booking cancelled successfully. No charges applied.",
            data: {
                cancellationFee,
                refundAmount,
                booking
            }
        });

    } catch (error) { 
        console.error("Critical Ambulance Cancel Error:", error);
        res.status(500).json({ success: false, message: "Server Error: " + error.message }); 
    }
};



// --- 2. GET USER BOOKING HISTORY (PAGINATED) ---
const getMyAmbulanceBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        // Query parameters: 'type', 'serviceType', ya 'status'
        const { type, serviceType, status } = req.query;
        const activeFilter = (type || serviceType || "").toLowerCase().trim();

        // Base Query: Logged-in user's bookings
        const query = { userId: req.user.id };

        // 🚨 DYNAMIC SERVICE TYPE FILTER (Case-Insensitive & Flexible)
        if (activeFilter && activeFilter !== 'all') {
            if (activeFilter === 'accidental' || activeFilter === 'accident emergency') {
                query.serviceType = 'Accident emergency';
            } 
            else if (activeFilter === 'medical' || activeFilter === 'medical ambulance' || activeFilter === 'quick response') {
                query.serviceType = { $in: ['Medical Ambulance', 'Quick Response'] };
            } 
            else if (activeFilter === 'referral' || activeFilter === 'referral ambulance') {
                query.serviceType = 'Referral Ambulance';
            } 
            else {
                // Direct exact match fallback if custom string passed
                query.serviceType = serviceType || type;
            }
        }

        // Optional Status Filter (e.g. status=Delivered ya status=Confirmed)
        if (status && status !== 'All') {
            query.status = status;
        }

        // Parallel execution for count & paginated records
        const [bookings, total] = await Promise.all([
            Booking.find(query)
                .populate('ambulanceId', 'name vehicleNumber vehicleType phone profilePic driverInfo')
                .populate('hospitalId', 'name address location phone hospitalImage')
                .populate('pickupHospitalId', 'name address location phone') // 👈 Referral ke liye Hospital A populate
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




module.exports = {
    getAmbulanceMasterData,
    getNearbyHospitals,
    getNearestAmbulances,getAmbulanceDetails,
    createAmbulanceBooking,
    getBookingStatus, getAmbulanceCoupons , validateAmbulanceCoupon,
    calculateAmbulanceFare,
    confirmAmbulanceBooking,initiateAmbulancePaymentAfterAcceptance,
    verifyAmbulancePayment, 
    // updateReview,addReview,

    getUserNumbers,
    createAccidentalBooking,
    uploadIncidentPhoto,
    getLiveTracking,

    createReferralBooking,
    cancelAmbulanceBooking,getMyAmbulanceBookings,


    getAmbulanceReviewsList,
    rateAmbulanceBooking

    
};