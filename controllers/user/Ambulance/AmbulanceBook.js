const Ambulance = require('../../../models/Ambulance');
const Booking = require('../../../models/AmbulanceBooking');
const Hospital = require('../../../models/Hospital');
const User = require('../../../models/User');
const Coupon = require('../../../models/Coupon');
const mongoose = require('mongoose'); // Upar ise import karein agar nahi hai toh

const { getDistance } = require('../../../utils/helpers');
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
            
            // Default pricing from DB
            let displayPrice = amb.pricing?.fixedPrice || 2000;
            let isFree = false;

            // STRICT OVERRIDE: Agar "Accident emergency" hai toh hamesha 0
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
                eta: `${Math.round(distance * 3)} mins` 
            };
        }));

        data.sort((a, b) => a.rawDistance - b.rawDistance);
        res.json({ success: true, count: data.length, data });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
const getAmbulanceDetails = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Fetch with Hospital Population
        const ambulance = await Ambulance.findById(id)
            .populate('hospitalId', 'name address city state hospitalImage location')
            .select('+password'); // Passwords/Tokens excluded by default usually, but we pick all fields

        if (!ambulance) return res.status(404).json({ message: "Ambulance not found" });

        // 2. Prepare Detailed Response
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
                rating: 4.8, // Static for now, can be calculated from Review model
                tripsCount: "1,240+" // Mock logic
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
            }
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
const getFinalFare = async (params) => {
    const { ambulanceId, serviceType, staffType, couponCode } = params;
    
    const amb = await Ambulance.findById(ambulanceId);
    if (!amb) throw new Error("Ambulance not found");

    // 1. Logic Check for Free Case
    const isFree = (serviceType === 'Accident emergency');
    
    let ambulanceCharge = isFree ? 0 : (amb.pricing?.fixedPrice || 2000);
    let supportingStaffCharge = 0;

    // 2. Staff Charge Calculation
    if (staffType) {
        if (isFree) {
            // Accident cases mein staff charge hamesha zero rahega
            supportingStaffCharge = 0;
        } else {
            // Paid cases mein database se price uthayenge
            if (staffType === 'Doctor') {
                if (!amb.supportStaff?.doctor?.available) throw new Error("This ambulance does not provide a Doctor");
                supportingStaffCharge = amb.supportStaff.doctor.price || 0;
            } 
            else if (staffType === 'Nurse') {
                if (!amb.supportStaff?.nurse?.available) throw new Error("This ambulance does not provide a Nurse");
                supportingStaffCharge = amb.supportStaff.nurse.price || 0;
            }
        }
    }

    let subtotal = ambulanceCharge + supportingStaffCharge;
    let discount = 0;
    let couponId = null;

    // 3. Coupon Logic (Only for Paid trips)
    if (couponCode && !isFree) {
        const coupon = await Coupon.findOne({ couponName: couponCode.toUpperCase(), isActive: true });
        if (coupon && subtotal >= coupon.minOrderAmount) {
            discount = (subtotal * coupon.discountPercentage) / 100;
            if (discount > coupon.maxDiscount) discount = coupon.maxDiscount;
            couponId = coupon._id;
        }
    }

    return { 
        ambulanceCharge, 
        supportingStaffCharge, 
        subtotal, 
        discount, 
        total: subtotal - discount, 
        isFree, 
        couponId 
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
// --- UNIVERSAL CONFIRM BOOKING ---
const confirmAmbulanceBooking = async (req, res) => {
    try {
        const { 
            ambulanceId, hospitalId, pickupHospitalId, serviceType, 
            triageLevel, patientDetails, staffType, couponCode, paymentId,
            scheduledDate, appointmentTime, incidentDescription 
        } = req.body;

        const fare = await getFinalFare(req.body); 

        // PATIENT DETAILS PARSING (Multipart form-data handles nested objects as strings)
        let parsedPatientDetails = {};
        if (typeof patientDetails === 'string') {
            try { parsedPatientDetails = JSON.parse(patientDetails); } catch (e) { parsedPatientDetails = {}; }
        } else { parsedPatientDetails = patientDetails || {}; }

        // HANDLE IMAGES FROM MULTER FIELDS
        let referralCardPath = null;
        let incidentPhotoPath = null;

        if (req.files) {
            if (req.files.referralCard) {
                referralCardPath = `/uploads/ambulances/${req.files.referralCard[0].filename}`;
            }
            if (req.files.incidentPhoto) {
                incidentPhotoPath = `/uploads/ambulances/${req.files.incidentPhoto[0].filename}`;
            }
        }

        const booking = await Booking.create({
            bookingId: `HK-AMB-${Date.now().toString().slice(-6)}`,
            caseReference: generateCaseRef(serviceType),
            userId: req.user.id,
            ambulanceId,
            hospitalId,
            pickupHospitalId: pickupHospitalId || null, 
            serviceType,
            triageLevel: serviceType === 'Accident emergency' ? 'Emergency' : triageLevel,
            scheduledAt: scheduledDate ? new Date(scheduledDate) : null,
            appointmentTime,
            patientDetails: {
                ...parsedPatientDetails,
                emergencyDescription: incidentDescription || parsedPatientDetails.emergencyDescription || "", 
                referralCard: referralCardPath,
                incidentPhoto: incidentPhotoPath
            },
            isFreeCase: fare.isFree,
            pricing: {
                ambulanceCharge: fare.ambulanceCharge,
                supportingStaffCharge: fare.supportingStaffCharge,
                discount: fare.discount,
                total: fare.total
            },
            paymentStatus: fare.isFree ? 'Paid' : (paymentId ? 'Paid' : 'Pending'),
            transactionId: paymentId || null,
            status: 'Confirmed',
            otp: Math.floor(1000 + Math.random() * 9000).toString()
        });

        await Ambulance.findByIdAndUpdate(ambulanceId, { availableForEmergency: false });

        res.status(201).json({ success: true, message: "Booking Initiated", booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


const addReview = async (req, res) => {
    try {
        const { targetId, targetType, orderId, rating, comment } = req.body;

        // Check if user already reviewed this order
        const existing = await Review.findOne({ userId: req.user.id, orderId });
        if (existing) return res.status(400).json({ message: "Review already submitted for this order" });

        const review = await Review.create({
            userId: req.user.id,
            userName: req.user.name,
            targetId,
            targetType,
            orderId,
            rating,
            comment
        });

        res.status(201).json({ success: true, message: "Review added successfully", data: review });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. UPDATE REVIEW ---
const updateReview = async (req, res) => {
    try {
        const { id } = req.params;
        const { rating, comment } = req.body;

        const review = await Review.findOneAndUpdate(
            { _id: id, userId: req.user.id },
            { $set: { rating, comment } },
            { new: true }
        );

        if (!review) return res.status(404).json({ message: "Review not found" });

        res.json({ success: true, message: "Review updated", data: review });
    } catch (error) { res.status(500).json({ message: error.message }); }
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
            emergencyDescription, // "What kind of emergency is?"
            phone 
        } = req.body;

        const amb = await Ambulance.findById(ambulanceId);
        if (!amb) return res.status(404).json({ message: "Ambulance not found" });

        // Logic: Accidental cases are free (Figma: $0.00)
        const isFree = amb.freeServices.accidental;

        const booking = await Booking.create({
            bookingId: `HK-ACC-${Date.now().toString().slice(-4)}`,
            caseReference: `HK-2026-${Math.floor(10000 + Math.random() * 90000)}`,
            userId: req.user.id,
            ambulanceId: ambulanceId,
            serviceType: 'Accident emergency',
            triageLevel: 'Emergency', // Accidental is always Emergency
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
            staffType, // 'Doctor' or 'Nurse'
            ambulanceId,
            triageLevel 
        } = req.body;

        const amb = await Ambulance.findById(ambulanceId);
        if (!amb) return res.status(404).json({ message: "Ambulance not found" });

        // Pricing Calculation (Screen 7)
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

        const booking = await Booking.findById(id);
        if (!booking) return res.status(404).json({ message: "Booking not found" });

        // Update Status
        booking.status = 'Cancelled';
        booking.trackingTimeline.push({ 
            status: 'Cancelled', 
            timestamp: new Date(), 
            note: reason || "Cancelled by User" 
        });

        // Driver ko wapas free karein
        if (booking.ambulanceId) {
            await Ambulance.findByIdAndUpdate(booking.ambulanceId, { availableForEmergency: true });
        }

        await booking.save();
        res.json({ success: true, message: "Booking cancelled successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. GET USER BOOKING HISTORY (PAGINATED) ---
const getMyAmbulanceBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;

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




module.exports = {
    getAmbulanceMasterData,
    getNearbyHospitals,
    getNearestAmbulances,getAmbulanceDetails,
    createAmbulanceBooking,
    getBookingStatus, getAmbulanceCoupons , validateAmbulanceCoupon,
    calculateAmbulanceFare,
    confirmAmbulanceBooking, updateReview,addReview,

    getUserNumbers,
    createAccidentalBooking,
    uploadIncidentPhoto,
    getLiveTracking,

    createReferralBooking,
    cancelAmbulanceBooking,getMyAmbulanceBookings
};