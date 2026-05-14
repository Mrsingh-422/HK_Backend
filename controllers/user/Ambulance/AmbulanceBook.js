const Ambulance = require('../../../models/Ambulance');
const Booking = require('../../../models/AmbulanceBooking');
const Hospital = require('../../../models/Hospital');
const User = require('../../../models/User');
const Coupon = require('../../../models/Coupon');
const { getDistance } = require('../../../utils/helpers');

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
            
            // Check if this ambulance offers this specific service for free
            let isFree = false;
            if (serviceType === 'Accident emergency' && amb.freeServices.accidental) isFree = true;
            if (serviceType === 'Medical Ambulance' && amb.freeServices.emergency) isFree = true;
            if (serviceType === 'Referral Ambulance' && amb.freeServices.referral) isFree = true;

            return {
                ...amb._doc,
                distance: `${distance} km`,
                rawDistance: distance,
                eta: `${Math.round(distance * 3)} mins`,
                isFreeForThisService: isFree,
                displayPrice: isFree ? 0 : amb.pricing.fixedPrice
            };
        }));

        data.sort((a, b) => a.rawDistance - b.rawDistance);
        res.json({ success: true, count: data.length, data });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getAmbulanceCoupons = async (req, res) => {
    try {
        const today = new Date();
        const coupons = await Coupon.find({
            vendorType: { $in: ['Ambulance', 'All'] },
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

// --- 3. CONFIRM BOOKING (Final Checkout Step - Figma Screen) ---
const confirmAmbulanceBooking = async (req, res) => {
    try {
        const { 
            ambulanceId, hospitalId, serviceType, triageLevel, 
            patientDetails, staffType 
        } = req.body;

        const amb = await Ambulance.findById(ambulanceId);
        if (!amb) return res.status(404).json({ message: "Ambulance not found" });

        // DETERMINE PRICING LOGIC
        let isFree = false;
        if (serviceType === 'Accident emergency' && amb.freeServices.accidental) isFree = true;
        
        const ambCharge = isFree ? 0 : (amb.pricing?.fixedPrice || 2000);
        const staffCharge = isFree ? 0 : (staffType === 'Doctor' ? 500 : (staffType === 'Nurse' ? 300 : 0));

        const booking = await Booking.create({
            bookingId: `BOK-${Date.now()}`,
            caseReference: `HK-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`,
            userId: req.user.id,
            ambulanceId,
            hospitalId,
            serviceType,
            triageLevel,
            patientDetails,
            isFreeCase: isFree,
            otp: Math.floor(1000 + Math.random() * 9000).toString(),
            pricing: {
                ambulanceCharge: ambCharge,
                supportingStaffCharge: staffCharge,
                total: ambCharge + staffCharge
            },
            status: 'Confirmed'
        });

        // Mark Driver Busy
        await Ambulance.findByIdAndUpdate(ambulanceId, { availableForEmergency: false });

        res.status(201).json({ success: true, message: "Booking Confirmed", booking });
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
        if (!req.file) return res.status(400).json({ message: "No photo uploaded" });

        const booking = await Booking.findByIdAndUpdate(bookingId, {
            'patientDetails.incidentPhoto': `/uploads/incidents/${req.file.filename}`
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









module.exports = {
    getAmbulanceMasterData,
    getNearbyHospitals,
    getNearestAmbulances,
    createAmbulanceBooking,
    getBookingStatus, getAmbulanceCoupons , validateAmbulanceCoupon,
    confirmAmbulanceBooking, updateReview,addReview,

    getUserNumbers,
    createAccidentalBooking,
    uploadIncidentPhoto,
    getLiveTracking
};