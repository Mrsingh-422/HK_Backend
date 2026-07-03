const Ambulance = require('../../../models/Ambulance');
const Booking = require('../../../models/AmbulanceBooking');
const Hospital = require('../../../models/Hospital');
const User = require('../../../models/User');
const Coupon = require('../../../models/Coupon');
const Review = require('../../../models/Review');
const Wallet = require('../../../models/Wallet');
const mongoose = require('mongoose');
const { getDistance } = require('../../../utils/helpers');
const { sendPushNotification,notifyAdminsAndVendor } = require('../../../utils/notification');
const { createRazorpayOrder, verifyRazorpaySignature,fetchAndMapRazorpayPayment } = require('../../../utils/razorpay'); // 👈 Razorpay Helpers Imported
const { checkAndApplyBenefit, deductBenefitCount,refundBenefitCount } = require('../../../utils/subscriptionBenefitHelper');

const generateCaseRef = (type) => {
    const prefix = type === 'Accident emergency' ? 'ACC' : (type === 'Referral Ambulance' ? 'REF' : 'MED');
    return `HK-${new Date().getFullYear()}-${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
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

        let query = { availableForEmergency: true, profileStatus: 'Approved' };
        if (vehicleType) query.vehicleType = vehicleType;

        const ambulances = await Ambulance.find(query);

        const data = await Promise.all(ambulances.map(async (amb) => {
            const distance = await getDistance(lat, lng, amb.location.lat, amb.location.lng);
            
            // 🚨 DYNAMIC RATING & REVIEWS CALCULATION FOR EACH AMBULANCE 🚨
            const reviews = await Review.find({ 
                targetId: amb._id, 
                targetType: 'Ambulance' 
            }).select('rating').lean();

            let averageRating = 4.8; // Default fallback if no reviews exist in DB yet
            if (reviews.length > 0) {
                const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
                averageRating = Number((totalRating / reviews.length).toFixed(1)); // e.g., 4.2
            }

            // Default pricing from DB
            let displayPrice = amb.pricing?.fixedPrice || 2000;
            let isFree = false;

            // STRICT OVERRIDE: Accident emergency is always free (₹0)
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
                displayPrice: displayPrice, // Frontend isko use karega
                isFreeCase: isFree,
                eta: `${Math.round(distance * 3)} mins`,
                rating: averageRating,       // 👈 ADDED DYNAMIC RATING
                totalReviews: reviews.length // 👈 ADDED DYNAMIC REVIEW COUNT
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

        // 1. Fetch Ambulance with Hospital Population
        const ambulance = await Ambulance.findById(id)
            .populate('hospitalId', 'name address city state hospitalImage location')
            .select('+password');

        if (!ambulance) return res.status(404).json({ message: "Ambulance not found" });

        // =========================================================================
        // 🚨 2. DYNAMIC RATING & REVIEWS CALCULATOR (RAG / Aggregate)
        // =========================================================================
        const reviews = await Review.find({ 
            targetId: id, 
            targetType: 'Ambulance' 
        }).select('rating').lean();

        let averageRating = 4.8; // Default fallback if no reviews exist in DB yet
        if (reviews.length > 0) {
            const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
            // Format to 1 decimal place (e.g., (5 + 2) / 2 = 3.5)
            averageRating = Number((totalRating / reviews.length).toFixed(1)); 
        }

        // 🚨 Fetch last 3 recent reviews for this specific ambulance
        const recentReviews = await Review.find({ targetId: id, targetType: 'Ambulance' })
            .select('userName rating comment createdAt')
            .sort({ createdAt: -1 })
            .limit(3)
            .lean();

        // 3. Prepare Detailed Response with Live Ratings & Recent Reviews
        const data = {
            _id: ambulance._id,
            // --- Driver / Identification ---
            driverInfo: {
                name: ambulance.driverInfo?.fullName || ambulance.name,
                phone: ambulance.phone,
                email: ambulance.email,
                experience: ambulance.experienceYears || "N/A",
                bloodGroup: ambulance.bloodGroup,
                department: ambulance.driverInfo?.department,
                rating: averageRating, // 👈 DYNAMICALLY CALCULATED!
                totalReviews: reviews.length, // 👈 Dynamic reviews counter
                tripsCount: reviews.length > 0 ? `${reviews.length * 3 + 120}+` : "1,240+" // Semi-dynamic
            },

            // --- Vehicle Details (Figma Screen 32/43) ---
            vehicle: {
                vehicleNumber: ambulance.vehicleNumber || "Not Assigned",
                vehicleType: ambulance.vehicleType, // Van, Mini Van, ALS, ICU
                serviceRadius: ambulance.serviceRadius,
                isAvailable: ambulance.availableForEmergency,
                features: ambulance.vehicleType === 'Advance Life Support' 
                    ? ["Ventilator", "Paramedic", "Oxygen", "Monitor"] 
                    : ["Oxygen Support", "First Aid Kit", "Stretcher"]
            },

            // --- Pricing & Supporting Staff (Dynamic) ---
            pricing: {
                basePrice: ambulance.pricing?.fixedPrice || 0,
                baseDistance: ambulance.pricing?.baseDistance || 0,
                extraKMPrice: ambulance.pricing?.pricePerKM || 0,
                
                // Detailed Support Staff Info
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

                // Service Specific Free Status
                freeServices: {
                    isAccidentalFree: ambulance.freeServices?.accidental || true, // Government standard
                    isEmergencyFree: ambulance.freeServices?.emergency || false,
                    isReferralFree: ambulance.freeServices?.referral || false
                }
            },

            // --- Location & Association ---
            location: ambulance.location,
            address: ambulance.address,
            
            // If it's a Hospital Ambulance, show Hospital info
            associatedHospital: ambulance.hospitalId ? {
                id: ambulance.hospitalId._id,
                name: ambulance.hospitalId.name,
                address: ambulance.hospitalId.address,
                image: ambulance.hospitalId.hospitalImage?.[0] || null
            } : null,

            // Documents (Paths for UI preview if needed)
            documents: {
                licenseVerified: !!ambulance.documents?.drivingLicenseFile,
                rcVerified: !!ambulance.documents?.rcFile,
                insuranceValid: !!ambulance.documents?.insuranceFile
            },

            // 🚨 ADDED: Dynamic Last 3 User Reviews List
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
    
    // 🚨 SUBSCRIPTION CHECK: Medical ya Referral rides ke liye free checks apply karein
    if (!isFree) {
        const ambBenefit = await checkAndApplyBenefit(userId, 'freeAmbulanceTripsCount', ambulanceCharge);
        ambulanceCharge = ambBenefit.amount; // Sets charge to 0 if free trips are left in plan
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
        ambulanceCharge, supportingStaffCharge, subtotal, 
        discount, total: subtotal - discount, isFree, 
        couponId, finalCouponCode 
    };
};

// --- 1. CHECKOUT API (Same Keys) ---
const calculateAmbulanceFare = async (req, res) => {
    try {
        const fare = await getFinalFare(req.body); // req.body contains all booking keys
        res.json({ success: true, data: fare });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. BOOKING API (Same Keys + Future Razorpay Support) ---
// --- UNIVERSAL CONFIRM BOOKING (Updated for Request-First Flow) ---

const confirmAmbulanceBooking = async (req, res) => {
    try {
        let body = { ...req.body };
        
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
            scheduledDate, appointmentTime 
        } = body;

        const fare = await getFinalFare(body, req.user.id); 

        let staffList = staffType ? (typeof staffType === 'string' ? staffType.split(',') : staffType) : [];
        staffList = staffList.map(s => s.trim());
        const supportStaffSelected = {
            doctor: staffList.includes('Doctor'),
            nurse: staffList.includes('Nurse')
        };

        let parsedDetails = {};
        if (typeof patientDetails === 'string') {
            try { parsedDetails = JSON.parse(patientDetails || '{}'); } catch (e) { parsedDetails = {}; }
        } else { parsedDetails = patientDetails || {}; }

        let referralCardPath = req.files?.referralCard ? `/uploads/ambulances/${req.files.referralCard[0].filename}` : null;
        let incidentPhotoPath = req.files?.incidentPhoto ? `/uploads/ambulances/${req.files.incidentPhoto[0].filename}` : null;

        let finalPickupLocation = { address: "Pickup Location", lat: 30.7046, lng: 76.7179 };

        const tempBookingId = `HK-BOK-${Date.now().toString().slice(-6)}`;
        let rzpOrder = null;

        if (!fare.isFree) {
            rzpOrder = await createRazorpayOrder(fare.total, `receipt_${tempBookingId}`);
        }

        const booking = await Booking.create({
            bookingId: tempBookingId,
            caseReference: generateCaseRef(serviceType),
            userId: req.user.id,
            ambulanceId,
            hospitalId,
            pickupHospitalId: pickupHospitalId || null, 
            serviceType,
            triageLevel: serviceType === 'Accident emergency' ? 'Emergency' : (triageLevel || 'Routine'),
            scheduledAt: scheduledDate ? new Date(scheduledDate) : null,
            scheduledTime: appointmentTime || null,
            supportStaffSelected: supportStaffSelected,
            pickupLocation: finalPickupLocation,
            patientDetails: {
                ...parsedDetails,
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
                supportingStaffCharge: fare.supportingStaffCharge,
                subtotal: fare.subtotal,
                discount: fare.discount,
                total: fare.total
            },
            isFreeCase: fare.isFree,
            paymentStatus: fare.isFree ? 'Paid' : 'Pending',
            transactionId: rzpOrder ? rzpOrder.id : (paymentId || null),
            status: 'Searching', 
            otp: Math.floor(1000 + Math.random() * 9000).toString()
        });

        if (fare.isFree) {
            // 🚨 SUBSCRIPTION DEDUCTION: Free/Discounted ambulance COD flow me trip deduct karein
            await deductBenefitCount(req.user.id, 'freeAmbulanceTripsCount');

            return res.status(201).json({ success: true, message: "Booking Request Sent Successfully (Free/Subscription Case)", booking });
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
        res.status(500).json({ message: error.message }); 
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

        // 🚨 SUBSCRIPTION DEDUCTION: Successful online payment confirm hone par trip deduct karein
        await deductBenefitCount(booking.userId, 'freeAmbulanceTripsCount');

        res.json({
            success: true,
            message: "Ambulance payment successfully verified!",
            data: booking
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};







// const addReview = async (req, res) => {
//     try {
//         const { targetId, targetType, orderId, rating, comment } = req.body;

//         // Check if user already reviewed this order
//         const existing = await Review.findOne({ userId: req.user.id, orderId });
//         if (existing) return res.status(400).json({ message: "Review already submitted for this order" });

//         const review = await Review.create({
//             userId: req.user.id,
//             userName: req.user.name,
//             targetId,
//             targetType,
//             orderId,
//             rating,
//             comment
//         });

//         res.status(201).json({ success: true, message: "Review added successfully", data: review });
//     } catch (error) { res.status(500).json({ message: error.message }); }
// };

// --- 2. UPDATE REVIEW ---
// const updateReview = async (req, res) => {
//     try {
//         const { id } = req.params;
//         const { rating, comment } = req.body;

//         const review = await Review.findOneAndUpdate(
//             { _id: id, userId: req.user.id },
//             { $set: { rating, comment } },
//             { new: true }
//         );

//         if (!review) return res.status(404).json({ message: "Review not found" });

//         res.json({ success: true, message: "Review updated", data: review });
//     } catch (error) { res.status(500).json({ message: error.message }); }
// };









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

// --- 4. GET LIVE TRACKING DATA (Figma Screen: Arriving / Start Navigation) ---
const getLiveTracking = async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id)
            .populate({
                path: 'ambulanceId',
                select: 'name phone vehicleNumber vehicleType location driverInfo profilePic'
            });

        if (!booking) return res.status(404).json({ message: "Booking not found" });

        // Figma Formatting
        const trackingData = {
            status: booking.status,
            otp: booking.otp,
            eta: "5 mins",
            driver: {
                name: booking.ambulanceId.driverInfo?.fullName || booking.ambulanceId.name,
                phone: booking.ambulanceId.phone,
                rating: 4.8,
                trips: "1,240",
                profilePic: booking.ambulanceId.profilePic
            },
            vehicle: {
                plateNumber: booking.ambulanceId.vehicleNumber,
                type: booking.ambulanceId.vehicleType // Figma: Van, ALS etc.
            },
            location: booking.ambulanceId.location,
            timeline: booking.trackingTimeline
        };

        res.json({ success: true, data: trackingData });
    } catch (error) { res.status(500).json({ message: error.message }); }
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

        const booking = await AmbulanceBooking.findOne({ _id: id, userId: req.user.id });
        if (!booking) {
            return res.status(404).json({ success: false, message: "Ambulance booking not found." });
        }

        if (['Arrived', 'Picked-Up', 'En-Route', 'Delivered', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ success: false, message: "Cannot cancel ambulance booking in its current state." });
        }

        booking.status = 'Cancelled';
        booking.trackingTimeline.push({ 
            status: 'Cancelled', 
            timestamp: new Date(), 
            note: reason || "Cancelled by User" 
        });

        if (booking.ambulanceId) {
            await Ambulance.findByIdAndUpdate(booking.ambulanceId, { availableForEmergency: true });
            
            await sendPushNotification(
                booking.ambulanceId, 
                'driver', 
                "Ride Cancelled", 
                "The patient has cancelled this booking request.",
                { bookingId: booking._id.toString(), type: 'booking_cancelled' }
            );
        }

        await booking.save();

        // 🚨 SUBSCRIPTION REFUND: Check if ambulance charge was 0 and it was NOT a default free emergency case
        if (booking.pricing?.ambulanceCharge === 0 && booking.serviceType !== 'Accident emergency') {
            const { refundBenefitCount } = require('../../../utils/subscriptionBenefitHelper');
            await refundBenefitCount(booking.userId, 'freeAmbulanceTripsCount');
        }

        res.json({ success: true, message: "Booking cancelled successfully" });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// --- 2. GET USER BOOKING HISTORY (PAGINATED) ---
const getMyAmbulanceBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;

        const bookings = await Booking.find({ userId: req.user.id })
            .populate('ambulanceId', 'name vehicleNumber vehicleType phone')
            .populate('hospitalId', 'name address')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        const total = await Booking.countDocuments({ userId: req.user.id });

        res.json({ 
            success: true, 
            count: bookings.length, 
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: bookings 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
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

        const booking = await AmbulanceBooking.findOne({ _id: bookingId, userId: req.user.id });
        if (!booking || booking.status !== 'Delivered') {
            return res.status(400).json({ success: false, message: "You can only rate completed ambulance trips." });
        }

        const existingReview = await Review.findOne({ userId: req.user.id, orderId: bookingId });
        if (existingReview) {
            return res.status(400).json({ success: false, message: "You have already submitted a review for this trip." });
        }

        // Create Polymorphic Review
        await Review.create({
            userId: req.user.id,
            userName: req.user.name || "Verified User",
            targetId: booking.ambulanceId,
            targetType: 'Ambulance',
            orderId: bookingId,
            rating,
            comment: comment || ""
        });

        // Recalculate average rating & sync to Ambulance profile
        const stats = await Review.aggregate([
            { $match: { targetId: booking.ambulanceId, targetType: 'Ambulance' } },
            { $group: { _id: null, averageRating: { $avg: "$rating" }, totalReviews: { $sum: 1 } } }
        ]);

        if (stats.length > 0) {
            await Ambulance.findByIdAndUpdate(booking.ambulanceId, {
                rating: Number(stats[0].averageRating.toFixed(1)),
                totalReviews: stats[0].totalReviews
            });
        }

        res.json({ success: true, message: "Thank you for rating our emergency transport!" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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