const Hospital = require('../../../models/Hospital');
const Ward = require('../../../models/Ward');
const Bed = require('../../../models/Bed');
const Appointment = require('../../../models/Appointment');
const HospitalService = require('../../../models/HospitalService');
const Coupon = require('../../../models/Coupon');
const Doctor = require('../../../models/Doctor');
const { getDistance } = require('../../../utils/helpers');
const crypto = require('crypto');
const moment = require('moment');

// 1. LIST HOSPITALS (Screenshot 18, 19)
const getHospitals = async (req, res) => {
    try {
        const { search, city, userLat, userLng } = req.body;
        
        let query = { profileStatus: 'Approved', isActive: true };
        if (city) query.city = { $regex: city, $options: 'i' };
        if (search) query.name = { $regex: search, $options: 'i' };

        let hospitals = await Hospital.find(query)
            .select('name address city state hospitalImage type averageRating totalReviews location')
            .lean(); // .lean() use karein taaki object modify kar sakein

        // Distance Calculation
        const dataWithDistance = await Promise.all(hospitals.map(async (hosp) => {
            let distance = 0;
            if (userLat && userLng && hosp.location?.lat) {
                distance = await getDistance(
                    parseFloat(userLat),
                    parseFloat(userLng),
                    hosp.location.lat,
                    hosp.location.lng
                );
            }
            return { ...hosp, distance };
        }));

        // Sort by distance (Nearest first)
        dataWithDistance.sort((a, b) => a.distance - b.distance);

        res.json({ success: true, count: dataWithDistance.length, data: dataWithDistance });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getHospitalDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const hospital = await Hospital.findById(id).select('-password -token').lean();
        if (!hospital) return res.status(404).json({ message: "Hospital not found" });

        // Fetch Wards, Doctors, and Admin-added Services (Figma S-29)
        const [wards, doctors, services] = await Promise.all([
            Ward.find({ hospitalId: id, isActive: true }),
            Doctor.find({ hospitalId: id, profileStatus: 'Approved' }).select('name speciality profileImage fees averageRating consultationStatus'),
            HospitalService.find({ hospitalId: id }) // Fetch Nurse, Security, etc.
        ]);

        res.json({
            success: true,
            data: { hospital, wards, doctors, services }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// 2. WARD & BED AVAILABILITY (Screenshot 22, 27)
// 2. WARD AVAILABILITY
const getWards = async (req, res) => {
    try {
        const { hospitalId, type } = req.query;
        console.log("Fetching Wards for Hospital:", hospitalId, "Type:", type);
        
        // Agar hospitalId nahi mili to error do
        if (!hospitalId) return res.status(400).json({ message: "hospitalId is required" });

        const query = { hospitalId, isActive: true };
        if (type) query.type = type;

        const wards = await Ward.find(query);
        res.json({ success: true, count: wards.length, data: wards });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// 3. BED GRID
const getBedGrid = async (req, res) => {
    try {
        const { wardId } = req.params;
        if (!wardId) return res.status(400).json({ message: "wardId is required" });

        const beds = await Bed.find({ wardId }).select('bedNumber status pricePerDay isVentilatorAvailable');
        res.json({ success: true, data: beds });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 1. ADD RATING (User Side) ---
const addReview = async (req, res) => {
    try {
        const { targetId, targetType, orderId, rating, comment } = req.body;

        // Validation: Check if user actually had this appointment
        const appointment = await Appointment.findOne({ _id: orderId, userId: req.user.id });
        if (!appointment) return res.status(403).json({ message: "You cannot review an order you didn't place." });

        const review = await Review.create({
            userId: req.user.id,
            userName: req.user.name,
            targetId,
            targetType,
            orderId,
            rating,
            comment
        });

        // RECALCULATE AVERAGE RATING (Production Standard)
        const allReviews = await Review.find({ targetId });
        const avg = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;

        if (targetType === 'Hospital') {
            await Hospital.findByIdAndUpdate(targetId, { averageRating: avg.toFixed(1), totalReviews: allReviews.length });
        } else if (targetType === 'Ambulance') {
            await Ambulance.findByIdAndUpdate(targetId, { averageRating: avg.toFixed(1), totalReviews: allReviews.length });
        }

        res.status(201).json({ success: true, message: "Review submitted successfully", data: review });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. UPDATE RATING ---
const updateReview = async (req, res) => {
    try {
        const { reviewId } = req.params;
        const { rating, comment } = req.body;

        const review = await Review.findOneAndUpdate(
            { _id: reviewId, userId: req.user.id },
            { $set: { rating, comment } },
            { new: true }
        );

        if (!review) return res.status(404).json({ message: "Review not found or unauthorized" });

        res.json({ success: true, message: "Review updated", data: review });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getDoctorsByHospitalId = async (req, res) => {
    try {
        const { hospitalId } = req.params;
        const doctors = await Doctor.find({ hospitalId, profileStatus: 'Approved', isActive: true })
            .select('name speciality qualification profileImage fees averageRating consultationStatus');
        res.json({ success: true, data: doctors });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
const getServicesByHospitalId = async (req, res) => {
    try {
        const { hospitalId } = req.params;
        const services = await HospitalService.find({ hospitalId })
            .select('serviceName price description image');
        res.json({ success: true, data: services });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


const getHospitalCoupons = async (req, res) => {
    try {
        const { hospitalId } = req.params;

        const coupons = await Coupon.find({
            isActive: true,
            expiryDate: { $gt: new Date() },
            $or: [
                { vendorId: hospitalId }, // Hospital specific coupons
                { isAdminCreated: true, vendorType: { $in: ['Hospital', 'All'] } } // Global coupons
            ]
        }).sort({ createdAt: -1 });

        res.json({ success: true, count: coupons.length, data: coupons });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. VALIDATE COUPON (Checkout Logic) ---
// endpoint: POST /user/hospital/validate-coupon
// --- 1. VALIDATE COUPON (Strict Logic) ---
const validateHospitalCoupon = async (req, res) => {
    try {
        const { couponCode, subtotal, hospitalId, doctorId } = req.body;
        
        // Validation: Fields required
        if (!couponCode || !subtotal) {
            return res.status(400).json({ success: false, message: "Coupon code and subtotal are required." });
        }

        const coupon = await Coupon.findOne({ 
            couponName: couponCode.toUpperCase(), 
            isActive: true 
        });

        if (!coupon) return res.status(404).json({ success: false, message: "Invalid or expired coupon." });

        // Minimum Amount Check
        if (Number(subtotal) < coupon.minOrderAmount) {
            return res.status(400).json({ success: false, message: `Minimum ₹${coupon.minOrderAmount} order required.` });
        }

        // Provider Check (Specific Coupon)
        const targetId = hospitalId || doctorId;
        if (coupon.vendorId && coupon.vendorId.toString() !== targetId) {
            return res.status(400).json({ success: false, message: "This coupon is not valid for this hospital/doctor." });
        }

        // Usage Check
        const userUsage = coupon.usedBy.find(u => u.userId.toString() === req.user.id);
        if (userUsage && userUsage.usageCount >= coupon.maxUsagePerUser) {
            return res.status(400).json({ success: false, message: "You've already used this coupon." });
        }

        let discount = (Number(subtotal) * coupon.discountPercentage) / 100;
        if (discount > coupon.maxDiscount) discount = coupon.maxDiscount;

        res.json({
            success: true,
            message: "Coupon Applied!",
            data: {
                couponId: coupon._id,
                discountAmount: Math.round(discount),
                finalAmount: Math.round(subtotal - discount)
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// --- 2. CHECKOUT SUMMARY (Beds + Doctors + Extra Services) ---
const getHospitalCheckoutSummary = async (req, res) => {
    try {
        const { doctorId, bedId, consultationType, couponCode, selectedServiceIds, triageLevel, days = 1 } = req.body;

        let baseFee = 0;
        let subtotal = 0;

        // CASE A: Doctor
        if (doctorId) {
            const doctor = await Doctor.findById(doctorId);
            const typeMap = { 'Video Consult': 'online', 'Clinic Visit': 'clinic', 'Home Visit': 'home' };
            const key = typeMap[consultationType];
            if (!doctor || !doctor.consultationStatus[key]) {
                return res.status(400).json({ message: "Consultation type is currently unavailable." });
            }
            baseFee = doctor.fees[key];
        } 
        // CASE B: Bed
        else if (bedId) {
            const bed = await Bed.findById(bedId);
            if (!bed || bed.status !== 'Available') return res.status(400).json({ message: "Bed is no longer available." });
            baseFee = bed.pricePerDay * days;
        }

        // Extra Services & Triage
        let serviceCharge = 0;
        if (selectedServiceIds?.length > 0) {
            const services = await HospitalService.find({ _id: { $in: selectedServiceIds } });
            serviceCharge = services.reduce((sum, s) => sum + s.price, 0);
        }
        const triageSurcharge = triageLevel === 'Emergency' ? 200 : 0;

        subtotal = baseFee + serviceCharge + triageSurcharge;

        // Discount logic for Summary
        let discount = 0;
        if (couponCode) {
            const coupon = await Coupon.findOne({ couponName: couponCode.toUpperCase(), isActive: true });
            if (coupon && subtotal >= coupon.minOrderAmount) {
                discount = Math.min((subtotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
            }
        }

        res.json({
            success: true,
            data: { baseFee, serviceCharge, triageSurcharge, discount, subtotal, totalPayable: subtotal - discount }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 3. FINAL BOOKING (Sync with Database) ---
const finalHospitalBooking = async (req, res) => {
    try {
        const { 
            hospitalId, doctorId, bedId, bookingType, triageLevel, 
            appointmentDate, patients, pricing, couponId, couponCode, selectedServiceIds 
        } = req.body;

        // Race condition bed check
        if (bedId) {
            const bed = await Bed.findById(bedId);
            if (!bed || bed.status !== 'Available') return res.status(400).json({ message: "Bed already occupied." });
        }

        const bookingId = `HKH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        
        const appointment = await Appointment.create({
            userId: req.user.id,
            hospitalId,
            doctorId: doctorId || null,
            bedId: bedId || null,
            bookingType: bedId ? 'Admission' : (bookingType || 'Appointment'),
            triageLevel: triageLevel || 'Routine',
            patients: typeof patients === 'string' ? JSON.parse(patients) : patients,
            appointmentDate,
            specialServices: selectedServiceIds || [],
            pricingBreakdown: {
                baseFee: pricing.baseFee,
                visitCharges: pricing.triageSurcharge || 0,
                extraCharges: pricing.serviceCharge || 0,
                discountAmount: pricing.discount || 0,
                subtotal: pricing.subtotal
            },
            couponDetails: couponId ? { couponId, couponCode, discountValue: pricing.discount } : undefined,
            totalAmount: pricing.totalPayable,
            bookingId,
            status: 'Confirmed', 
            paymentStatus: 'Paid',
            'tracking.otp': Math.floor(1000 + Math.random() * 9000).toString()
        });

        // Bed Status Update
        if (bedId) {
            const b = await Bed.findByIdAndUpdate(bedId, { $set: { status: 'Occupied' } });
            await Ward.findByIdAndUpdate(b.wardId, { $inc: { availableBeds: -1 } });
        }

        // Coupon Usage Update
        if (couponId) {
            await Coupon.findByIdAndUpdate(couponId, { $push: { usedBy: { userId: req.user.id, usageCount: 1 } } });
        }

        res.status(201).json({ success: true, bookingId, data: appointment });
    } catch (error) { res.status(500).json({ message: error.message }); }
};



// 5. GET MY BOOKINGS (Screenshot 20, 21 - Upcoming, Pending, History)
const getMyHospitalBookings = async (req, res) => {
    try {
        const { tab } = req.query; // 'Upcoming', 'Pending', 'History'
        let query = { userId: req.user.id };

        if (tab === 'Upcoming') query.status = 'Confirmed';
        else if (tab === 'Pending') query.status = { $in: ['Pending', 'Hospital-Pending'] };
        else if (tab === 'History') query.status = { $in: ['Completed', 'Cancelled-By-User', 'Cancelled-By-Hospital'] };

        const data = await Appointment.find(query)
            .populate('hospitalId', 'name address hospitalImage')
            .populate('doctorId', 'name speciality profileImage')
            .sort({ appointmentDate: 1 });

        res.json({ success: true, data });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// GET FAMILY MEMBERS FOR BUBBLES (Screenshot 24)
const getBookingProfiles = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('name profilePic familyMember');
        // Main User + Family members ka array merge karke bhejein
        const profiles = [
            { id: user._id, name: "My Self", profilePic: user.profilePic, relation: 'Self' },
            ...user.familyMember.map(fm => ({ id: fm._id, name: fm.memberName, profilePic: fm.profilePic, relation: fm.relation }))
        ];
        res.json({ success: true, data: profiles });
    } catch (error) { res.status(500).json({ message: error.message }); }
};



module.exports = { 
    getHospitals, getWards, getBedGrid,getDoctorsByHospitalId, getServicesByHospitalId, getHospitalCoupons, validateHospitalCoupon,
    getHospitalCheckoutSummary, finalHospitalBooking, getMyHospitalBookings, getBookingProfiles,
    getHospitalDetails, addReview, updateReview
};