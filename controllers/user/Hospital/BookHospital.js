const Hospital = require('../../../models/Hospital');
const Ward = require('../../../models/Ward');
const Bed = require('../../../models/Bed');
const Appointment = require('../../../models/Appointment');
const HospitalService = require('../../../models/HospitalService');
const Coupon = require('../../../models/Coupon');
const Doctor = require('../../../models/Doctor');
const User = require('../../../models/User');
const Ambulance = require('../../../models/Ambulance');
const BedRescheduleLimit = require('../../../models/BedRescheduleLimit');
const UserSubscription = require('../../../models/UserSubscription');
const Availability = require('../../../models/Availability');

const { generateTimeSlots } = require('../../../utils/timeSlotHelper');
const Review = require('../../../models/Review');
const DocReschleduleLimit = require("../../../models/DocRescheduleLimit");
const { getDistance } = require('../../../utils/helpers');
const crypto = require('crypto');
const moment = require('moment');
const mongoose = require('mongoose');
const { sendPushNotification, notifyAdminsAndVendor } = require('../../../utils/notification'); // For Notifications

const { createRazorpayOrder, verifyRazorpaySignature,fetchAndMapRazorpayPayment } = require('../../../utils/razorpay'); // 👈 Razorpay Helpers Imported
const { checkAndApplyBenefit, deductBenefitCount,refundBenefitCount } = require('../../../utils/subscriptionBenefitHelper');
const { processCancellationRefund } = require('../../../utils/policyHelper');
const { isCodEnabled } = require('../../../utils/policyHelper');


// @desc    List / Search Hospitals for Users (Supports City, Speciality, GPS Distance & Insurance Filters)
// @route   POST /user/hospital/list
// @access  Public / Optional Auth
const getHospitals = async (req, res) => {
    try {
        const { city, search, userLat, userLng, isInsuranceAccepted, insuranceCompany, page = 1, limit = 20 } = req.body;

        const query = { profileStatus: 'Approved', isActive: true };

        if (city && city.trim() !== '') {
            query.city = { $regex: city.trim(), $options: 'i' };
        }

        // Filter by Insurance Acceptance
        if (isInsuranceAccepted !== undefined && isInsuranceAccepted !== 'All') {
            query.isInsuranceAccepted = (isInsuranceAccepted === 'true' || isInsuranceAccepted === true);
        }

        // Filter by Specific Insurance Provider (e.g. "HDFC ERGO", "Star Health", "RGHS")
        if (insuranceCompany && insuranceCompany.trim() !== "") {
            query.acceptedInsurances = { $regex: insuranceCompany.trim(), $options: 'i' };
        }

        let matchedHospitalIds = null;

        // If search keyword provided, search by Name, City, or Doctor Speciality
        if (search && search.trim() !== '') {
            const cleanSearch = search.trim();
            const doctorMatches = await Doctor.find({
                role: 'hospital-doctor',
                isActive: true,
                speciality: { $regex: cleanSearch, $options: 'i' }
            }).select('hospitalId').lean();

            const doctorHospitalIds = doctorMatches.map(d => d.hospitalId).filter(Boolean);

            query.$or = [
                { name: { $regex: cleanSearch, $options: 'i' } },
                { city: { $regex: cleanSearch, $options: 'i' } },
                { _id: { $in: doctorHospitalIds } }
            ];
        }

        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 20;
        const skip = (pageNum - 1) * limitNum;

        const hospitals = await Hospital.find(query)
            .select('name address city state hospitalImage type rating totalReviews location isInsuranceAccepted acceptedInsurances')
            .skip(skip)
            .limit(limitNum)
            .lean();

        const total = await Hospital.countDocuments(query);

        // Calculate dynamic real-world distance if user coordinates provided
        const enrichedHospitals = await Promise.all(hospitals.map(async (h) => {
            let distanceInKm = 0;
            if (userLat && userLng && h.location?.lat && h.location?.lng) {
                distanceInKm = await getDistance(Number(userLat), Number(userLng), Number(h.location.lat), Number(h.location.lng));
            }

            return {
                ...h,
                distance: distanceInKm > 0 ? `${distanceInKm} km away` : "Nearby",
                distanceInKm,
                isInsuranceAccepted: h.isInsuranceAccepted !== false,
                acceptedInsurances: h.acceptedInsurances || []
            };
        }));

        if (userLat && userLng) {
            enrichedHospitals.sort((a, b) => a.distanceInKm - b.distanceInKm);
        }

        res.status(200).json({
            success: true,
            total,
            count: enrichedHospitals.length,
            currentPage: pageNum,
            totalPages: Math.ceil(total / limitNum),
            data: enrichedHospitals
        });

    } catch (error) {
        console.error("Get Hospitals List Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// @desc    Get Hospital Full Details with Departments, Wards, Doctors and Insurance Acceptance
// @route   GET /user/hospital/details/:id
// @access  Public / Optional Auth
const getHospitalDetails = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: "Invalid Hospital ID format." });
        }

        const hospital = await Hospital.findById(id).select('-password -token').lean();
        if (!hospital) {
            return res.status(404).json({ success: false, message: "Hospital not found." });
        }

        // Parallel lookup for hospital resources
        const [wards, doctors, services] = await Promise.all([
            Ward.find({ hospitalId: id, isActive: true }).lean(),
            Doctor.find({ hospitalId: id, role: 'hospital-doctor', isActive: true })
                .select('name speciality qualification profileImage fees department slotDuration averageRating totalReviews')
                .lean(),
            mongoose.model('HospitalService').find({ hospitalId: id }).lean()
        ]);

        res.status(200).json({
            success: true,
            data: {
                hospital: {
                    ...hospital,
                    // Return Insurance Acceptance Flags
                    isInsuranceAccepted: hospital.isInsuranceAccepted !== false,
                    acceptedInsurances: hospital.acceptedInsurances || [
                        "HDFC ERGO", "Star Health", "Care Health", "ICICI Lombard", "RGHS", "Ayushman Bharat"
                    ]
                },
                wards: wards || [],
                doctors: doctors.map(doc => ({
                    ...doc,
                    opdFee: doc.fees?.clinic || 500,
                    roomNumber: doc.department?.roomNumber || "Cabin 1"
                })),
                specialServices: services || []
            }
        });

    } catch (error) {
        console.error("Get Hospital Details Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
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
        const { startDate, endDate } = req.query; 

        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, message: "Please select date range." });
        }

        const userStart = moment(startDate).startOf('day').toDate();
        const userEnd = moment(endDate).endOf('day').toDate();

        const allBeds = await Bed.find({ wardId }).lean();
        const bedIds = allBeds.map(b => b._id);

        // 🚀 SYNC FIX: Included 'Discharge-Pending' in active overlap checking query
        const overlaps = await Appointment.find({
            bedId: { $in: bedIds },
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending', 'Discharge-Pending'] },
            $and: [
                { startDate: { $lte: userEnd } },
                { endDate: { $gte: userStart } }
            ]
        }).select('bedId');

        const bookedIds = overlaps.filter(o => o.bedId).map(o => o.bedId.toString());

        const data = allBeds.map(bed => {
            let dynamicStatus = bed.status;

            if (bookedIds.includes(bed._id.toString())) {
                dynamicStatus = 'Occupied'; 
            } else if (bed.status === 'Occupied' || bed.status === 'Reserved') {
                dynamicStatus = 'Available'; 
            }

            return {
                ...bed,
                status: dynamicStatus
            };
        });

        res.json({ success: true, data });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
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

// @desc    Get All Approved Doctors of a Specific Hospital (Enriched with OPD Fee, Cabin Room & Experience)
// @route   GET /user/hospital/doctors/:hospitalId
// @access  Public / User
const getDoctorsByHospitalId = async (req, res) => {
    try {
        const { hospitalId } = req.params;
        const { department, search } = req.query;

        let query = { 
            hospitalId, 
            profileStatus: 'Approved', 
            isActive: true 
        };

        if (department && department !== 'All') {
            query.speciality = { $regex: department.trim(), $options: 'i' };
        }

        if (search && search.trim() !== '') {
            query.$or = [
                { name: { $regex: search.trim(), $options: 'i' } },
                { speciality: { $regex: search.trim(), $options: 'i' } }
            ];
        }

        const doctors = await Doctor.find(query)
            .select('name speciality qualification profileImage fees averageRating totalReviews consultationStatus experienceYears languages department slotDuration')
            .lean();

        const formattedDoctors = doctors.map(doc => ({
            _id: doc._id,
            name: doc.name,
            speciality: doc.speciality,
            qualification: doc.qualification || "MBBS, MD",
            profileImage: doc.profileImage || null,
            experienceYears: doc.experienceYears || 0,
            averageRating: doc.averageRating || 4.5,
            totalReviews: doc.totalReviews || 0,
            languages: doc.languages || ["English", "Hindi"],
            // OPD Specific Pricing & Logistics
            opdFee: Number(doc.fees?.clinic || 500),
            opdAvailable: doc.consultationStatus?.clinic ?? true,
            opdRoomNumber: doc.department?.roomNumber || "OPD Cabin 1",
            slotDurationMinutes: doc.slotDuration || 15
        }));

        res.status(200).json({ 
            success: true, 
            count: formattedDoctors.length, 
            data: formattedDoctors 
        });

    } catch (error) { 
        console.error("Get Doctors By Hospital ID Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
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
// --- 1. DATE-RANGE BASED BED GRID (Screenshot 27 Logic) ---
// endpoint: POST /api/user/hospital/check-availability
const getAvailableBedsForRange = async (req, res) => {
    try {
        const { hospitalId, wardId, startDate, endDate } = req.body;

        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, message: "Please select date range." });
        }

        const start = moment(startDate).startOf('day').toDate();
        const end = moment(endDate).endOf('day').toDate();

        const allBeds = await Bed.find({ wardId }).lean();
        const bedIds = allBeds.map(b => b._id);

        // 🚀 SYNC FIX: Included 'Discharge-Pending' in active overlap checking query
        const overlappingAppointments = await Appointment.find({
            hospitalId,
            bedId: { $in: bedIds },
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending', 'Discharge-Pending'] },
            $and: [
                { startDate: { $lte: end } },
                { endDate: { $gte: start } }
            ]
        }).select('bedId');

        const bookedBedIds = overlappingAppointments.filter(appt => appt.bedId).map(appt => String(appt.bedId));

        const bedGrid = allBeds.map(bed => {
            let dynamicStatus = bed.status;

            if (bookedBedIds.includes(String(bed._id))) {
                dynamicStatus = 'Occupied';
            } else if (bed.status === 'Occupied' || bed.status === 'Reserved') {
                dynamicStatus = 'Available';
            }

            return { 
                ...bed, 
                status: dynamicStatus 
            };
        });

        res.json({ success: true, data: bedGrid });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// for conditional subcription plan check, we will use the middleware requireConditionPlan in the routes for specialized disease care bookings. This middleware will ensure that only users with an active subscription for the required disease care plan can access the booking endpoints.
// @desc    Calculate Clean IPD Checkout Summary (Bed Fee + Multi-Format Special Services - Coupon)
// @route   POST /user/hospital/checkout-summary
// @access  Private (User)
const getHospitalCheckoutSummary = async (req, res) => {
    try {
        const userId = req.user.id;
        const { hospitalId, bedId, startDate, endDate, triageLevel = 'Routine', couponCode } = req.body;

        // Support all possible frontend keys
        const rawSpecialServices = req.body.specialServices || req.body['specialServices[]'] || req.body.selectedServices || req.body.services;

        if (!hospitalId || !bedId || !startDate || !endDate) {
            return res.status(400).json({ 
                success: false, 
                message: "hospitalId, bedId, startDate (YYYY-MM-DD), and endDate (YYYY-MM-DD) are required." 
            });
        }

        const startMoment = moment(startDate, "YYYY-MM-DD").startOf('day');
        const endMoment = moment(endDate, "YYYY-MM-DD").startOf('day');

        if (!startMoment.isValid() || !endMoment.isValid() || endMoment.isBefore(startMoment)) {
            return res.status(400).json({ success: false, message: "Invalid date range. End date must be on or after start date." });
        }

        let stayDays = endMoment.diff(startMoment, 'days');
        if (stayDays <= 0) stayDays = 1;

        // 1. Fetch Bed Details
        const bed = await Bed.findOne({ _id: bedId, hospitalId }).populate('wardId', 'name type');
        if (!bed) {
            return res.status(404).json({ success: false, message: "Selected bed not found in this hospital." });
        }

        const baseBedPrice = Number(bed.pricePerDay || 1000) * stayDays;

        // 2. 🛡️ UNIVERSAL SPECIAL SERVICES PARSER (Handles IDs, Objects, Names & Arrays)
        let verifiedSpecialServicesList = [];
        let specialServicesTotal = 0;

        if (rawSpecialServices) {
            let itemsToParse = [];
            if (typeof rawSpecialServices === 'string') {
                try {
                    const parsed = JSON.parse(rawSpecialServices);
                    itemsToParse = Array.isArray(parsed) ? parsed : [parsed];
                } catch(e) {
                    itemsToParse = rawSpecialServices.split(',').map(s => s.trim());
                }
            } else if (Array.isArray(rawSpecialServices)) {
                itemsToParse = rawSpecialServices;
            }

            const cleanIds = [];
            const cleanNames = [];

            itemsToParse.forEach(item => {
                if (!item) return;
                if (typeof item === 'string') {
                    if (mongoose.isValidObjectId(item.trim())) {
                        cleanIds.push(item.trim());
                    } else {
                        cleanNames.push(item.trim());
                    }
                } else if (typeof item === 'object') {
                    const candidateId = item._id || item.serviceId || item.id;
                    if (candidateId && mongoose.isValidObjectId(candidateId)) {
                        cleanIds.push(String(candidateId).trim());
                    } else if (item.serviceName || item.name) {
                        cleanNames.push(String(item.serviceName || item.name).trim());
                    }
                }
            });

            const orConditions = [];
            if (cleanIds.length > 0) orConditions.push({ _id: { $in: [...new Set(cleanIds)] } });
            if (cleanNames.length > 0) orConditions.push({ serviceName: { $in: [...new Set(cleanNames)] } });

            if (orConditions.length > 0) {
                const dbServices = await HospitalService.find({
                    hospitalId,
                    $or: orConditions
                }).lean();

                const seenServiceIds = new Set();
                dbServices.forEach(srv => {
                    const srvIdStr = srv._id.toString();
                    if (!seenServiceIds.has(srvIdStr)) {
                        seenServiceIds.add(srvIdStr);
                        const price = Number(srv.price || 0);
                        specialServicesTotal += price;
                        verifiedSpecialServicesList.push({
                            serviceId: srv._id,
                            serviceName: srv.serviceName,
                            price: price,
                            description: srv.description || ""
                        });
                    }
                });
            }
        }

        // Subtotal = Pure Bed Price + Verified Special Services (No hidden charges)
        const subtotal = baseBedPrice + specialServicesTotal;

        // 3. Coupon Calculation
        let couponDiscount = 0;
        let appliedCouponData = null;

        if (couponCode && String(couponCode).trim() !== '') {
            const coupon = await Coupon.findOne({
                couponName: String(couponCode).trim().toUpperCase(),
                isActive: true,
                expiryDate: { $gte: new Date() }
            });

            if (coupon && subtotal >= (coupon.minOrderAmount || 0)) {
                if (coupon.vendorId?.toString() === hospitalId.toString() || coupon.vendorType === 'Hospital' || coupon.vendorType === 'All') {
                    couponDiscount = Math.min((subtotal * coupon.discountPercentage) / 100, coupon.maxDiscount || 9999);
                    appliedCouponData = {
                        couponId: coupon._id,
                        couponCode: coupon.couponName,
                        discountPercentage: coupon.discountPercentage,
                        discountAmount: couponDiscount
                    };
                }
            }
        }

        const totalPayable = Math.max(0, Math.round(subtotal - couponDiscount));

        res.status(200).json({
            success: true,
            message: "IPD Checkout summary calculated successfully.",
            data: {
                hospitalId,
                bedId: bed._id,
                bedNumber: bed.bedNumber,
                wardName: bed.wardId?.name || "General Ward",
                wardType: bed.wardId?.type || "Ward",
                days: stayDays,
                baseFee: baseBedPrice,
                pricePerDay: bed.pricePerDay,
                triageLevel: triageLevel,
                serviceCharge: specialServicesTotal,
                specialServicesBreakdown: verifiedSpecialServicesList,
                subtotal: subtotal,
                discount: couponDiscount,
                appliedCoupon: appliedCouponData,
                totalPayable: totalPayable
            }
        });

    } catch (error) {
        console.error("Get Hospital Checkout Summary Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// @desc    Book Hospital Bed (IPD Admission) with Safe Age Calculation & Concurrency Check
// @route   POST /user/hospital/book
// @access  Private (User)
const finalHospitalBooking = async (req, res) => {
    try {
        const userId = req.user.id;
        let { 
            hospitalId, 
            bedId, 
            startDate, 
            endDate, 
            bookingType, 
            triageLevel, 
            patients, 
            pricing, 
            paymentMethod,
            couponCode, 
            bookingReason,
            specialServices,
            insuranceDetails 
        } = req.body;

        // 1. Mandatory Parameters Check
        if (!hospitalId || !bedId || !startDate || !endDate) {
            return res.status(400).json({ 
                success: false, 
                errorType: "MISSING_REQUIRED_FIELDS",
                message: "hospitalId, bedId, startDate (Check-In), and endDate (Check-Out) are required." 
            });
        }

        if (!mongoose.isValidObjectId(hospitalId) || !mongoose.isValidObjectId(bedId)) {
            return res.status(400).json({ 
                success: false, 
                errorType: "INVALID_OBJECT_ID",
                message: "hospitalId and bedId must be valid MongoDB ObjectIds." 
            });
        }

        // 2. Safe Parsing for FormData Stringified Payloads
        const safeParseJSON = (data, defaultVal) => {
            if (!data) return defaultVal;
            if (typeof data === 'object') return data;
            try { return JSON.parse(data); } catch (e) { return defaultVal; }
        };

        let parsedPatients = safeParseJSON(patients, []);
        let parsedPricing = safeParseJSON(pricing, {});
        let parsedSpecialServices = safeParseJSON(specialServices, []);
        let parsedInsurance = safeParseJSON(insuranceDetails, {});

        // 3. Date Validation: Check-In vs Check-Out (Minimum 1 day stay)
        const checkInMoment = moment(startDate).startOf('day');
        const checkOutMoment = moment(endDate).startOf('day');

        if (!checkInMoment.isValid() || !checkOutMoment.isValid()) {
            return res.status(400).json({ 
                success: false, 
                errorType: "INVALID_DATE_FORMAT",
                message: "Invalid date format. Expected 'YYYY-MM-DD'." 
            });
        }

        if (checkOutMoment.isSameOrBefore(checkInMoment)) {
            return res.status(400).json({ 
                success: false, 
                errorType: "INVALID_STAY_DURATION",
                message: "Check-out date must be after check-in date. Minimum hospital admission stay is 1 day." 
            });
        }

        const stayDays = Math.max(1, checkOutMoment.diff(checkInMoment, 'days'));

        // 4. Verify Hospital & Bed Status
        const hospital = await Hospital.findById(hospitalId).select('name address city isActive').lean();
        if (!hospital || hospital.isActive === false) {
            return res.status(404).json({ success: false, message: "Hospital not found or inactive." });
        }

        const bed = await Bed.findById(bedId).populate('wardId', 'name type').lean();
        if (!bed) {
            return res.status(404).json({ success: false, message: "Bed not found." });
        }

        if (bed.status !== 'Available') {
            return res.status(400).json({ 
                success: false, 
                errorType: "BED_NOT_AVAILABLE",
                message: `Selected Bed '${bed.bedNumber}' is currently ${bed.status}. Please select another bed.` 
            });
        }

        // 5. Overlapping Booking Collision Check for the Selected Date Range
        const overlappingBooking = await Appointment.findOne({
            bedId,
            status: { $in: ['Hospital-Pending', 'Confirmed', 'In-Progress'] },
            $or: [
                { startDate: { $lt: checkOutMoment.toDate() }, endDate: { $gt: checkInMoment.toDate() } }
            ]
        });

        if (overlappingBooking) {
            return res.status(400).json({ 
                success: false, 
                errorType: "BED_ALREADY_RESERVED",
                message: `Bed '${bed.bedNumber}' is already reserved by another patient for the selected dates.` 
            });
        }

        // 🚨 6. BUG FIX: Safe Patient Normalization (Calculates patientAge from DOB if missing)
        let formattedPatients = [];
        if (Array.isArray(parsedPatients) && parsedPatients.length > 0) {
            formattedPatients = parsedPatients.map(p => {
                let age = Number(p.patientAge || p.age || 0);

                // Auto-calculate age if missing but dob exists
                if ((!age || age <= 0) && (p.dob || p.dateOfBirth)) {
                    const birthYear = moment(p.dob || p.dateOfBirth).year();
                    if (!isNaN(birthYear)) {
                        age = Math.max(1, moment().year() - birthYear);
                    }
                }

                return {
                    patientName: String(p.patientName || p.name || req.user.name || "Patient").trim(),
                    patientAge: age > 0 ? age : 30, // Fallback prevents Mongoose ValidationError
                    gender: p.gender || "Male",
                    relation: p.relation || "Self",
                    reasonForVisit: p.reasonForVisit || bookingReason || "Hospital In-Patient Admission",
                    isMainUser: Boolean(p.isMainUser)
                };
            });
        } else {
            // Default to logged-in user profile
            const userBirthYear = req.user.dob ? moment(req.user.dob).year() : null;
            const defaultAge = userBirthYear ? Math.max(1, moment().year() - userBirthYear) : 30;

            formattedPatients.push({
                patientName: req.user.name || "Patient",
                patientAge: defaultAge,
                gender: req.user.gender || "Male",
                relation: "Self",
                reasonForVisit: bookingReason || "Hospital In-Patient Admission",
                isMainUser: true
            });
        }

        // 7. Calculate Pricing
        const pricePerDay = Number(bed.pricePerDay || 1000);
        const baseStayFee = pricePerDay * stayDays;
        
        let visitCharges = Number(parsedPricing.visitCharges || 0);
        let extraCharges = Number(parsedPricing.extraCharges || 0);
        let subtotal = baseStayFee + visitCharges + extraCharges;

        // Apply Coupon Discount if provided
        let discount = 0;
        let appliedCouponDetails = null;

        if (couponCode && String(couponCode).trim() !== "") {
            const cleanCoupon = String(couponCode).trim().toUpperCase();
            const coupon = await Coupon.findOne({
                couponName: cleanCoupon,
                isActive: true,
                expiryDate: { $gte: new Date() },
                $or: [
                    { vendorId: hospitalId },
                    { isAdminCreated: true, vendorType: { $in: ['Hospital', 'All'] } }
                ]
            });

            if (coupon && subtotal >= (coupon.minOrderAmount || 0)) {
                discount = Math.min(Math.round((subtotal * coupon.discountPercentage) / 100), coupon.maxDiscount || subtotal);
                appliedCouponDetails = {
                    couponId: coupon._id,
                    couponCode: coupon.couponName,
                    discountValue: discount
                };
            }
        }

        const finalTotalPayable = Math.max(0, subtotal - discount);

        // 8. Capture Insurance Files from Multer
        let frontCard = null;
        let backCard = null;
        let singleDoc = null;

        if (req.files) {
            if (req.files.insuranceDocument && req.files.insuranceDocument[0]) {
                singleDoc = `/uploads/insurance/${req.files.insuranceDocument[0].filename}`;
            }
            if (req.files.insuranceDocumentFront && req.files.insuranceDocumentFront[0]) {
                frontCard = `/uploads/insurance/${req.files.insuranceDocumentFront[0].filename}`;
            }
            if (req.files.insuranceDocumentBack && req.files.insuranceDocumentBack[0]) {
                backCard = `/uploads/insurance/${req.files.insuranceDocumentBack[0].filename}`;
            }
        }

        const bookingId = `HKH-ADM-${Date.now().toString().slice(-6)}`;
        const cleanMethod = String(paymentMethod || 'Online').toUpperCase() === 'COD' ? 'COD' : 'Online';

        // 9. Create Appointment Document (IPD Admission)
        const appointment = await Appointment.create({
            userId,
            hospitalId,
            bedId: bed._id,
            bookingType: 'Admission', // 👈 Strictly IPD Admission
            bedBookingType: 'General-Bed',
            triageLevel: triageLevel || 'Routine',
            bookingId,
            bookingReason: bookingReason || "Hospital In-Patient Bed Stay",
            wardName: bed.wardId?.name || "General Ward",
            bedNumber: bed.bedNumber,
            startDate: checkInMoment.toDate(),
            endDate: checkOutMoment.toDate(),
            stayDuration: stayDays,
            patients: formattedPatients,
            status: 'Hospital-Pending', // Waiting for Hospital verification / approval
            paymentMethod: cleanMethod,
            paymentStatus: 'Pending',
            totalAmount: finalTotalPayable,
            pricingBreakdown: {
                baseFee: baseStayFee,
                originalBaseFee: baseStayFee,
                visitCharges,
                extraCharges,
                discountAmount: discount,
                subtotal,
                totalPayable: finalTotalPayable,
                bookedDurationDays: stayDays,
                depositPaidOnBooking: finalTotalPayable
            },
            couponDetails: appliedCouponDetails,
            specialServices: Array.isArray(parsedSpecialServices) ? parsedSpecialServices : [],
            insuranceDetails: {
                hasInsurance: Boolean(parsedInsurance.hasInsurance),
                companyName: parsedInsurance.companyName || "",
                insuranceNumber: parsedInsurance.insuranceNumber || "",
                insuranceType: parsedInsurance.insuranceType || "",
                insuranceDocument: singleDoc,
                insuranceDocumentFront: frontCard,
                insuranceDocumentBack: backCard,
                approvalStatus: 'Pending'
            }
        });

        // 10. Temporarily Reserve Bed
        await Bed.findByIdAndUpdate(bed._id, { $set: { status: 'Reserved' } });

        // 11. Handle Online Payment via Razorpay
        if (cleanMethod === 'Online' && finalTotalPayable > 0) {
            const rzpOrder = await createRazorpayOrder(finalTotalPayable, `rcpt_adm_${bookingId}`);

            appointment.paymentDetails = {
                razorpayOrderId: rzpOrder.id,
                amount: finalTotalPayable,
                currency: 'INR',
                status: 'created'
            };
            await appointment.save();

            return res.status(201).json({
                success: true,
                isOnlinePayment: true,
                message: `Bed admission request initiated. Bed ${bed.bedNumber} reserved. Complete payment of ₹${finalTotalPayable} to confirm.`,
                key_id: process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID,
                amount: rzpOrder.amount, // in paise
                currency: "INR",
                razorpayOrderId: rzpOrder.id,
                appointmentId: appointment._id,
                bookingId: appointment.bookingId,
                stayDays,
                totalPayable: finalTotalPayable
            });
        }

        // Pay at Counter / Cash Flow
        res.status(201).json({
            success: true,
            isOnlinePayment: false,
            message: `Bed admission request submitted successfully! Booking ID: ${bookingId}. Deposit of ₹${finalTotalPayable} payable at hospital counter.`,
            appointmentId: appointment._id,
            bookingId: appointment.bookingId,
            stayDays,
            totalPayable: finalTotalPayable,
            data: appointment
        });

    } catch (error) {
        console.error("Final Hospital Booking Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};



// @desc    Verify Razorpay Online Payment for Hospital Bookings (Handles both OPD Consultations & IPD Bed Admissions)
// @route   POST /user/hospital/verify-payment
// @access  Private (User)
const verifyHospitalPayment = async (req, res) => {
    try {
        const { appointmentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
        const userId = req.user.id;

        if (!appointmentId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(400).json({ 
                success: false, 
                message: "Missing payment verification parameters (appointmentId, razorpayOrderId, razorpayPaymentId, razorpaySignature)." 
            });
        }

        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const query = {
            userId,
            ...(isObjectId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(query)
            .populate('doctorId', 'name speciality department')
            .populate('hospitalId', 'name address');

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment record not found or access denied." });
        }

        if (appointment.paymentStatus === 'Paid') {
            return res.status(200).json({ 
                success: true, 
                message: "Payment already verified and confirmed.", 
                data: appointment 
            });
        }

        // 1. Verify Razorpay Cryptographic Signature
        const isSignatureValid = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        
        // Development bypass / production strictness
        const isDev = process.env.NODE_ENV === 'development';
        if (!isSignatureValid && !isDev) {
            return res.status(400).json({ success: false, message: "Invalid payment signature. Verification failed." });
        }

        // 2. Fetch Payment Metadata
        let paymentDetails = null;
        try {
            paymentDetails = await fetchAndMapRazorpayPayment(razorpayPaymentId, razorpaySignature);
        } catch (fetchErr) {}

        if (!paymentDetails) {
            paymentDetails = {
                razorpayPaymentId,
                razorpayOrderId,
                razorpaySignature,
                method: 'Online',
                amount: appointment.totalAmount,
                currency: 'INR',
                status: 'captured',
                paidAt: new Date()
            };
        }

        // 3. Update Appointment Status
        appointment.paymentStatus = 'Paid';
        appointment.status = 'Confirmed';
        appointment.paymentMethod = 'Online';
        appointment.paymentDetails = paymentDetails;

        // 🚨 CRITICAL NULL-CHECK: Only lock bed if booking is an IPD Bed Admission (OPD has no bedId)
        if (appointment.bookingType === 'Admission' && appointment.bedId) {
            await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Reserved' } });
        }

        await appointment.save();

        const hospitalName = appointment.hospitalId?.name || "Hospital";
        const doctorName = appointment.doctorId?.name || "Doctor";

        // 4. Send Confirmation Push Notifications
        if (appointment.bookingType === 'OPD') {
            // Alert Patient with OPD Token Number & Cabin
            try {
                await sendPushNotification(
                    userId,
                    'user',
                    `🎟️ OPD Token #${appointment.tokenNumber || '1'} Confirmed!`,
                    `Your OPD consultation with Dr. ${doctorName} at ${hospitalName} is confirmed for ${appointment.appointmentTime}. Cabin: ${appointment.opdRoomNumber || 'Consultation Cabin'}.`,
                    {
                        type: 'OPD_TOKEN_CONFIRMED',
                        serviceType: 'Hospital',
                        appointmentId: String(appointment._id),
                        bookingId: String(appointment.bookingId),
                        tokenNumber: String(appointment.tokenNumber || '1'),
                        click_action: 'FLUTTER_NOTIFICATION_CLICK'
                    }
                );
            } catch (e) {}

            // Alert Doctor in Cabin
            if (appointment.doctorId) {
                try {
                    await sendPushNotification(
                        appointment.doctorId._id,
                        'doctor',
                        `New OPD Patient (Token #${appointment.tokenNumber || '1'})`,
                        `${appointment.patients[0]?.patientName} has paid online for OPD Token #${appointment.tokenNumber}.`,
                        {
                            type: 'NEW_OPD_PATIENT',
                            appointmentId: String(appointment._id),
                            tokenNumber: String(appointment.tokenNumber || '1'),
                            click_action: 'FLUTTER_NOTIFICATION_CLICK'
                        }
                    );
                } catch (e) {}
            }
        }

        res.status(200).json({
            success: true,
            message: appointment.bookingType === 'OPD' 
                ? `Payment verified! OPD Token #${appointment.tokenNumber} confirmed.`
                : "Payment verified! Bed admission confirmed.",
            tokenNumber: appointment.tokenNumber || null,
            bookingId: appointment.bookingId,
            data: appointment
        });

    } catch (error) {
        console.error("Verify Hospital Payment Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// @desc    Cancel Hospital Booking by User (Handles both OPD Consultation and IPD Admission Cancellations)
// @route   PATCH /user/hospital/cancel/:id
// @access  Private (User)
const cancelBedBooking = async (req, res) => {
    try {
        const { id } = req.params; 
        const { reason } = req.body;
        const userId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            userId,
            $or: [
                ...(isObjectId ? [{ _id: new mongoose.Types.ObjectId(id) }] : []),
                { bookingId: String(id).trim() }
            ]
        };

        // Allows cancelling both 'Admission' and 'OPD' booking types
        const appt = await Appointment.findOne(query);
        if (!appt) {
            return res.status(404).json({ success: false, message: "Booking record not found or access denied." });
        }

        const terminalStates = ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital', 'No-Show'];
        if (terminalStates.includes(appt.status)) {
            return res.status(400).json({ success: false, message: `Cannot cancel booking in '${appt.status}' state.` });
        }

        const isOPD = appt.bookingType === 'OPD';
        const globalConfig = await BedRescheduleLimit.findOne();
        const maxLimit = globalConfig ? globalConfig.maxLimit : 2;

        const currentCancelCount = appt.cancellationCount || 0;
        if (currentCancelCount >= maxLimit) {
            return res.status(400).json({
                success: false,
                message: `Cancellation Blocked: Maximum cancellations limit (${maxLimit}) reached.`
            });
        }

        // Process refund and fees via policy helper
        const policyResult = await processCancellationRefund(appt, 'Hospital');

        // IPD Only: Release bed if bed was reserved or occupied
        if (!isOPD && appt.bedId) {
            const bed = await Bed.findById(appt.bedId);
            if (bed && (bed.status === 'Reserved' || bed.status === 'Occupied')) {
                bed.status = 'Available';
                await bed.save();
                
                await Ward.findOneAndUpdate(
                    { name: appt.wardName, hospitalId: appt.hospitalId },
                    { $inc: { availableBeds: 1 } }
                );
            }
        }

        appt.status = 'Cancelled-By-User';
        appt.cancellationCount = currentCancelCount + 1;
        appt.cancelReason = reason || (isOPD ? "Cancelled by Patient (OPD)" : "Cancelled by Patient (IPD)");
        
        if (!appt.pricingBreakdown) appt.pricingBreakdown = {};
        appt.pricingBreakdown.cancellationFeeApplied = policyResult.cancellationFee;

        // Payment Refund Queueing
        if (appt.paymentStatus === 'Paid' && policyResult.refundAmount > 0) {
            appt.paymentStatus = 'Refund-Initiated';
        }

        await appt.save();

        // Restore subscription quota if applied
        if (appt.subscriptionDetails?.isSubscriptionApplied) {
            const benefitKey = isOPD ? 'freeDoctorAppointmentsCount' : 'freeHospitalStaysCount';
            await refundBenefitCount(appt.userId, benefitKey);
        }

        // Real-Time Notification to Hospital / Doctor
        try {
            const notifMsg = isOPD 
                ? `OPD Appointment #${appt.bookingId} (Token #${appt.tokenNumber || 'N/A'}) was cancelled by patient.`
                : `IPD Admission #${appt.bookingId} for Bed ${appt.bedNumber || ''} was cancelled by patient.`;

            await notifyAdminsAndVendor(
                appt.hospitalId,
                'hospital',
                `Hospital Booking Cancelled (${appt.bookingType})`,
                notifMsg,
                { bookingId: appt._id.toString(), type: 'hospital_booking_cancelled' }
            );

            if (isOPD && appt.doctorId) {
                await sendPushNotification(
                    appt.doctorId,
                    'doctor',
                    "OPD Patient Cancelled",
                    `Patient cancelled OPD token #${appt.tokenNumber || 'N/A'}.`,
                    { bookingId: appt._id.toString(), type: 'opd_patient_cancelled' }
                );
            }
        } catch (e) {}

        res.status(200).json({
            success: true,
            message: policyResult.cancellationFee > 0
                ? `${appt.bookingType} booking cancelled. A cancellation charge of ₹${policyResult.cancellationFee} was applied.`
                : `${appt.bookingType} booking cancelled successfully. No charges deducted.`,
            data: {
                bookingType: appt.bookingType,
                cancellationFee: policyResult.cancellationFee,
                refundAmount: policyResult.refundAmount,
                booking: appt
            }
        });

    } catch (error) {
        console.error("Cancel Hospital Booking Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Reschedule Hospital Booking by User (Handles both OPD Consultation and IPD Bed Admissions)
// @route   POST /user/hospital/reschedule
// @access  Private (User)
const rescheduleBedBooking = async (req, res) => {
    try {
        const { 
            appointmentId, 
            newStartDate, 
            newEndDate, 
            newBedId, 
            newTimeSlot, 
            newDoctorId, 
            reason 
        } = req.body;

        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const query = {
            userId: req.user.id,
            ...(isObjectId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appt = await Appointment.findOne(query);
        if (!appt) {
            return res.status(404).json({ success: false, message: "Booking record not found or access denied." });
        }

        const terminalStates = ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital', 'No-Show'];
        if (terminalStates.includes(appt.status)) {
            return res.status(400).json({ success: false, message: `Cannot reschedule appointment in '${appt.status}' state.` });
        }

        const globalConfig = await BedRescheduleLimit.findOne();
        const maxLimit = globalConfig ? globalConfig.maxLimit : 2;
        const currentRescheduleCount = appt.rescheduleCount || 0;

        if (currentRescheduleCount >= maxLimit) {
            return res.status(400).json({ 
                success: false, 
                message: `Reschedule failed: Maximum reschedule limit (${maxLimit} times) reached.` 
            });
        }

        // =========================================================================
        // 🩺 BRANCH 1: OPD CONSULTATION RESCHEDULE LOGIC
        // =========================================================================
        if (appt.bookingType === 'OPD') {
            const targetDateStr = newStartDate || req.body.newDate;
            const targetSlot = newTimeSlot || appt.appointmentTime;
            const targetDoctorId = (newDoctorId && mongoose.isValidObjectId(newDoctorId)) ? newDoctorId : appt.doctorId;

            if (!targetDateStr) {
                return res.status(400).json({ success: false, message: "newStartDate (YYYY-MM-DD) is required for OPD reschedule." });
            }

            const targetDate = moment(targetDateStr).startOf('day').toDate();
            const endOfDay = moment(targetDateStr).endOf('day').toDate();

            // Verify doctor exists in hospital
            const doctor = await Doctor.findOne({ _id: targetDoctorId, hospitalId: appt.hospitalId, profileStatus: 'Approved', isActive: true });
            if (!doctor) {
                return res.status(404).json({ success: false, message: "Doctor not found or inactive in this hospital." });
            }

            // Check if doctor is on approved leave on target date
            const isDoctorOnLeave = (doctor.leaves || []).some(l => {
                if (l.status !== 'Approved') return false;
                const lStart = moment(l.startDate).startOf('day');
                const lEnd = moment(l.endDate).endOf('day');
                return moment(targetDateStr).isSameOrAfter(lStart) && moment(targetDateStr).isSameOrBefore(lEnd);
            });

            if (isDoctorOnLeave) {
                return res.status(400).json({ success: false, message: `Dr. ${doctor.name} is on approved leave on ${targetDateStr}. Please pick another date.` });
            }

            // Generate next token number on that date
            const todayBookingsCount = await Appointment.countDocuments({
                hospitalId: appt.hospitalId,
                doctorId: targetDoctorId,
                bookingType: 'OPD',
                appointmentDate: { $gte: targetDate, $lte: endOfDay },
                status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital'] }
            });
            const newTokenNumber = todayBookingsCount + 1;

            appt.appointmentDate = targetDate;
            appt.appointmentTime = targetSlot;
            appt.doctorId = targetDoctorId;
            appt.tokenNumber = newTokenNumber;
            appt.rescheduleCount = currentRescheduleCount + 1;
            appt.rescheduleReason = reason || "Patient rescheduled OPD appointment.";
            appt.status = 'Rescheduled';

            await appt.save();

            // Notify Hospital and Doctor
            try {
                await notifyAdminsAndVendor(
                    appt.hospitalId,
                    'hospital',
                    "Patient Rescheduled OPD Appointment",
                    `Patient ${appt.patients[0]?.patientName} moved OPD visit to ${moment(targetDateStr).format('DD MMM')} (${targetSlot}). New Token is #${newTokenNumber}.`,
                    { appointmentId: appt._id.toString(), type: 'opd_patient_rescheduled', tokenNumber: newTokenNumber }
                );

                await sendPushNotification(
                    targetDoctorId,
                    'doctor',
                    "OPD Appointment Rescheduled",
                    `Patient moved consultation to ${moment(targetDateStr).format('DD MMM')} (${targetSlot}). New Token is #${newTokenNumber}.`,
                    { appointmentId: appt._id.toString(), type: 'opd_patient_rescheduled', tokenNumber: newTokenNumber }
                );
            } catch (e) {}

            return res.status(200).json({
                success: true,
                message: `OPD Appointment rescheduled successfully. Your new Token is #${newTokenNumber}.`,
                bookingType: 'OPD',
                tokenNumber: newTokenNumber,
                data: appt
            });
        }

        // =========================================================================
        // 🏨 BRANCH 2: IPD BED ADMISSION RESCHEDULE LOGIC
        // =========================================================================
        if (!newStartDate || !newEndDate) {
            return res.status(400).json({ success: false, message: "newStartDate and newEndDate are required for IPD Bed Admission reschedule." });
        }

        const originalStart = moment(appt.startDate).startOf('day');
        const originalEnd = moment(appt.endDate).startOf('day');
        const originalDuration = originalEnd.diff(originalStart, 'days');

        const start = moment(newStartDate).startOf('day').toDate();
        const end = moment(newEndDate).endOf('day').toDate();

        const newStartMoment = moment(newStartDate).startOf('day');
        const newEndMoment = moment(newEndDate).endOf('day');
        const newDuration = newEndMoment.diff(newStartMoment, 'days');

        if (originalDuration !== newDuration) {
            return res.status(400).json({
                success: false,
                message: `Reschedule failed: Original stay was ${originalDuration} days. Please select exactly ${originalDuration} days.`
            });
        }

        const targetBedId = newBedId || appt.bedId;

        const isOccupied = await Appointment.findOne({
            _id: { $ne: appt._id },
            bedId: targetBedId,
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending', 'Discharge-Pending'] },
            $and: [
                { startDate: { $lte: end } },
                { endDate: { $gte: start } }
            ]
        });

        if (isOccupied) {
            return res.status(400).json({ 
                success: false, 
                message: "Selected bed is already booked for these dates. Please choose another bed or dates." 
            });
        }

        if (newBedId && String(newBedId) !== String(appt.bedId)) {
            if (appt.bedId) {
                const oldBed = await Bed.findByIdAndUpdate(appt.bedId, { status: 'Available' });
                if (oldBed && oldBed.wardId) {
                    await Ward.findByIdAndUpdate(oldBed.wardId, { $inc: { availableBeds: 1 } });
                }
            }

            const newBed = await Bed.findById(newBedId);
            if (newBed) {
                newBed.status = 'Reserved';
                await newBed.save();
                if (newBed.wardId) {
                    await Ward.findByIdAndUpdate(newBed.wardId, { $inc: { availableBeds: -1 } });
                    const ward = await Ward.findById(newBed.wardId);
                    appt.wardName = ward ? ward.name : appt.wardName;
                }
                appt.bedNumber = newBed.bedNumber;
            }
            appt.bedId = newBedId;
        }

        appt.startDate = start;
        appt.endDate = end;
        appt.rescheduleCount = currentRescheduleCount + 1;
        appt.status = 'Hospital-Pending'; 

        await appt.save();

        res.status(200).json({ 
            success: true, 
            message: "IPD Admission rescheduled successfully.", 
            bookingType: 'Admission',
            data: appt 
        });

    } catch (error) { 
        console.error("Reschedule Booking Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

const getBedMonthlySchedule = async (req, res) => {
    try {
        const { bedId, month, year } = req.query;

        if (!bedId) {
            return res.status(400).json({ success: false, message: "bedId is required." });
        }

        const targetMonth = month ? parseInt(month) : moment().month() + 1; 
        const targetYear = year ? parseInt(year) : moment().year();

        const bed = await Bed.findById(bedId);
        if (!bed) return res.status(404).json({ success: false, message: "Bed not found" });

        const startOfMonth = moment([targetYear, targetMonth - 1]).startOf('month');
        const endOfMonth = moment([targetYear, targetMonth - 1]).endOf('month');

        const totalDays = endOfMonth.date(); 

        // 🚀 SYNC FIX: Included 'Discharge-Pending' in active overlap checking query
        const bookings = await Appointment.find({
            bedId,
            bookingType: 'Admission',
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending', 'Discharge-Pending'] },
            $and: [
                { startDate: { $lte: endOfMonth.toDate() } },
                { endDate: { $gte: startOfMonth.toDate() } }
            ]
        }).populate('userId', 'name');

        const calendar = [];

        for (let day = 1; day <= totalDays; day++) {
            const currentDay = moment([targetYear, targetMonth - 1, day]).startOf('day');
            const currentDayDate = currentDay.toDate();
            
            const match = bookings.find(b => {
                const bStart = moment(b.startDate).startOf('day').toDate();
                const bEnd = moment(b.endDate).startOf('day').toDate();
                return currentDayDate >= bStart && currentDayDate <= bEnd;
            });

            let dayStatus = 'Available';
            if (match) {
                dayStatus = 'Occupied';
            } else if (bed.status === 'Maintenance') {
                dayStatus = 'Maintenance'; 
            }

            calendar.push({
                date: currentDay.format("YYYY-MM-DD"),
                day: day,
                status: dayStatus,
                currentOccupant: match ? (match.patients?.[0]?.patientName || match.userId?.name || 'Admitted') : null,
                bookingId: match ? match.bookingId : null
            });
        }

        res.json({
            success: true,
            month: targetMonth,
            year: targetYear,
            totalDays,
            bedDetails: {
                bedNumber: bed.bedNumber,
                pricePerDay: bed.pricePerDay
            },
            data: calendar
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get All Hospital Bookings for Logged-In User (Filter by Tab & BookingType)
// @route   GET /user/hospital/my-bookings
// @access  Private (User)
const getMyHospitalBookings = async (req, res) => {
    try {
        const { tab, bookingType, page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        let query = { userId: req.user.id };

        // Filter by bookingType: 'OPD' or 'Admission' (default: return both if not specified)
        if (bookingType && bookingType !== 'All') {
            query.bookingType = bookingType;
        }

        if (tab === 'Upcoming') {
            query.status = { $in: ['Confirmed', 'In-Progress'] };
        } else if (tab === 'Pending') {
            query.status = { $in: ['Pending', 'Hospital-Pending'] };
        } else if (tab === 'History') {
            query.status = { $in: ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital', 'No-Show'] };
        }

        const totalCount = await Appointment.countDocuments(query);

        const globalConfig = await BedRescheduleLimit.findOne();
        const maxLimit = globalConfig ? globalConfig.maxLimit : 2;

        const data = await Appointment.find(query)
            .populate('hospitalId', 'name address hospitalImage city phone')
            .populate('doctorId', 'name speciality profileImage fees department')
            .populate({
                path: 'bedId',
                select: 'bedNumber status pricePerDay isVentilatorAvailable wardId',
                populate: { path: 'wardId', select: 'name type' }
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        res.status(200).json({ 
            success: true, 
            count: data.length,
            maxRescheduleLimit: maxLimit,
            pagination: {
                totalCount,
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                currentPage: parseInt(page),
                limit: parseInt(limit)
            },
            data 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// GET FAMILY MEMBERS FOR BUBBLES (Screenshot 24)
const getBookingProfiles = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('name profilePic familyMember bloodGroup');
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        // Main User + Family members array merged with Blood Group
        const profiles = [
            { 
                id: user._id, 
                name: "My Self", 
                profilePic: user.profilePic, 
                relation: 'Self',
                bloodGroup: user.bloodGroup || null 
            },
            ...user.familyMember.map(fm => ({ 
                id: fm._id, 
                name: fm.memberName, 
                profilePic: fm.profilePic, 
                relation: fm.relation,
                bloodGroup: fm.bloodGroup || null 
            }))
        ];

        res.json({ success: true, data: profiles });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};


// @desc    Rate Completed Hospital Visit (Supports both OPD Consultation & IPD Bed Admission)
// @route   POST /user/hospital/rate
// @access  Private (User)
const rateHospitalAdmission = async (req, res) => {
    try {
        const { bookingId, rating, comment } = req.body;
        const userId = req.user.id;

        if (!bookingId || !rating || Number(rating) < 1 || Number(rating) > 5) {
            return res.status(400).json({ 
                success: false, 
                message: "bookingId and a valid rating score between 1 and 5 are required." 
            });
        }

        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = {
            userId,
            bookingType: { $in: ['Admission', 'OPD'] }, // 👈 Allows both OPD and IPD
            ...(isObjectId ? { _id: bookingId } : { bookingId: String(bookingId).trim() })
        };

        const booking = await Appointment.findOne(query);

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: "Completed hospital appointment/admission record not found." 
            });
        }

        if (booking.status !== 'Completed') {
            return res.status(400).json({ 
                success: false, 
                message: "You can only rate completed consultations or discharged admissions." 
            });
        }

        // Check if already reviewed
        const existingReview = await Review.findOne({ userId, orderId: booking._id });
        if (existingReview) {
            return res.status(400).json({ 
                success: false, 
                message: "You have already submitted a review for this hospital appointment." 
            });
        }

        // 1. Create Polymorphic Review for Hospital
        const review = await Review.create({
            userId,
            userName: req.user.name || "Verified Patient",
            targetId: booking.hospitalId,
            targetType: 'Hospital',
            orderId: booking._id,
            rating: Number(rating),
            comment: comment ? String(comment).trim() : "Visit completed successfully."
        });

        // 2. Recalculate Hospital Live Average Rating
        const hospitalReviews = await Review.find({ targetId: booking.hospitalId, targetType: 'Hospital' });
        const hospAvg = hospitalReviews.reduce((sum, r) => sum + r.rating, 0) / hospitalReviews.length;

        await Hospital.findByIdAndUpdate(booking.hospitalId, {
            $set: {
                averageRating: Number(hospAvg.toFixed(1)),
                totalReviews: hospitalReviews.length
            }
        });

        // 3. If OPD had an assigned doctor, update Doctor Rating as well
        if (booking.doctorId) {
            const doctorReviews = await Review.find({ targetId: booking.doctorId, targetType: 'Doctor' });
            if (doctorReviews.length > 0) {
                const docAvg = doctorReviews.reduce((sum, r) => sum + r.rating, 0) / doctorReviews.length;
                await Doctor.findByIdAndUpdate(booking.doctorId, {
                    $set: {
                        averageRating: Number(docAvg.toFixed(1)),
                        totalReviews: doctorReviews.length
                    }
                });
            }
        }

        res.status(201).json({ 
            success: true, 
            message: "Thank you for rating your hospital visit experience!", 
            data: review 
        });

    } catch (error) {
        console.error("Rate Hospital Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};



// Universal time normalizer to 24-hr format (e.g. "09:40 AM", "9:40 AM", "09:40" -> "09:40")
const normalizeTo24Hour = (timeStr) => {
    if (!timeStr) return "";
    const clean = String(timeStr).trim();
    const m = moment(clean, ["HH:mm", "H:mm", "hh:mm A", "h:mm A", "hh:mm a", "h:mm a"]);
    return m.isValid() ? m.format("HH:mm") : clean;
};
// @desc    Get Doctor OPD Time Slots for Selected Date with Accurate Premium Surcharges
// @route   GET /user/hospital/doctors/:doctorId/opd-slots
// @access  Public
const getHospitalDoctorOpdSlots = async (req, res) => {
    try {
        const { doctorId } = req.params;
        const { date } = req.query; // Format: YYYY-MM-DD

        if (!doctorId || !mongoose.isValidObjectId(doctorId)) {
            return res.status(400).json({ success: false, message: "Valid Doctor ID is required." });
        }

        const selectedDate = date ? moment(date).format('YYYY-MM-DD') : moment().format('YYYY-MM-DD');

        // 1. Fetch Doctor Profile
        const doctor = await Doctor.findById(doctorId).select('name fees department slotDuration availability isActive');
        if (!doctor || !doctor.isActive) {
            return res.status(404).json({ success: false, message: "Doctor not found or inactive." });
        }

        const baseFee = Number(doctor.fees?.clinic || 500);
        const slotDuration = Math.max(5, Number(doctor.slotDuration || 15));

        // 2. Fetch Doctor's Availability & Premium Slots Configuration
        const availabilityConfig = await Availability.findOne({ vendorId: doctorId, vendorType: 'Doctor' }).lean();

        const premiumSlots = availabilityConfig?.premiumSlots || [];
        const unavailableSlots = (availabilityConfig?.unavailableSlots || []).map(t => normalizeTo24Hour(t));
        const offDays = availabilityConfig?.offDays || [];

        const dayName = moment(selectedDate).format('dddd');
        if (offDays.includes(dayName)) {
            return res.status(200).json({
                success: true,
                isClosed: true,
                message: `Doctor is off on ${dayName}s.`,
                slots: []
            });
        }

        // 3. Determine Operating Hours for this Day
        const dayShort = moment(selectedDate).format('ddd'); // Mon, Tue...
        const daySchedule = (doctor.availability || []).find(a => a.day === dayShort);

        const startTimeStr = daySchedule?.startTime || availabilityConfig?.startTime || "09:00";
        const endTimeStr = daySchedule?.endTime || availabilityConfig?.endTime || "17:00";

        // 4. Fetch already booked/confirmed appointments for this doctor on this day
        const startOfDay = moment(selectedDate).startOf('day').toDate();
        const endOfDay = moment(selectedDate).endOf('day').toDate();

        const bookedAppointments = await Appointment.find({
            doctorId,
            appointmentDate: { $gte: startOfDay, $lte: endOfDay },
            bookingType: 'OPD',
            status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital', 'No-Show'] }
        }).select('appointmentTime').lean();

        const bookedTimeSet = new Set(bookedAppointments.map(a => normalizeTo24Hour(a.appointmentTime)));

        // 5. Generate Time Slots
        const slots = [];
        const startMoment = moment(`${selectedDate} ${startTimeStr}`, 'YYYY-MM-DD HH:mm');
        const endMoment = moment(`${selectedDate} ${endTimeStr}`, 'YYYY-MM-DD HH:mm');
        const isToday = moment().format('YYYY-MM-DD') === selectedDate;
        const now = moment();

        while (startMoment.isBefore(endMoment)) {
            const time24 = startMoment.format("HH:mm");
            const displayTime = startMoment.format("hh:mm A");

            const isPast = isToday && startMoment.isBefore(now);
            const isManuallyBlocked = unavailableSlots.includes(time24);
            const isAlreadyBooked = bookedTimeSet.has(time24);

            const isAvailable = !isPast && !isManuallyBlocked && !isAlreadyBooked;

            // Check if this slot is a configured premium slot
            const matchedPremium = premiumSlots.find(ps => normalizeTo24Hour(ps.time) === time24);
            const extraFee = matchedPremium ? Number(matchedPremium.extraFee || 0) : 0;
            const isPremium = extraFee > 0;
            const totalFee = baseFee + extraFee;

            const hour = startMoment.hour();
            let category = "Morning";
            if (hour >= 12 && hour < 17) category = "Afternoon";
            else if (hour >= 17) category = "Evening";

            slots.push({
                time: time24,
                displayTime,
                category,
                baseFee,
                extraFee,
                totalFee,
                isPremium,
                isAvailable,
                status: !isAvailable ? (isPast ? "Past" : (isAlreadyBooked ? "Booked" : "Unavailable")) : "Available"
            });

            startMoment.add(slotDuration, 'minutes');
        }

        res.status(200).json({
            success: true,
            isClosed: false,
            date: selectedDate,
            doctorName: doctor.name,
            roomNumber: doctor.department?.roomNumber || "Cabin 1",
            baseFee,
            totalSlotsCount: slots.length,
            availableSlotsCount: slots.filter(s => s.isAvailable).length,
            slots
        });

    } catch (error) {
        console.error("Get Hospital Doctor OPD Slots Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// @desc    Calculate OPD Checkout Bill Summary (Fix: Preserves Premium Slot Surcharge & Normalizes Times)
// @route   POST /user/hospital/opd/checkout-summary
// @access  Private (User)
const getHospitalOpdCheckoutSummary = async (req, res) => {
    try {
        const { doctorId, hospitalId, appointmentDate, appointmentTime, timeSlot, couponCode } = req.body;
        const userId = req.user.id;

        if (!doctorId || !mongoose.isValidObjectId(doctorId)) {
            return res.status(400).json({ success: false, message: "Valid doctorId is required." });
        }

        // 1. Fetch Doctor details
        const doctor = await Doctor.findById(doctorId).populate('hospitalId', 'name address city isInsuranceAccepted acceptedInsurances').lean();
        if (!doctor || !doctor.isActive) {
            return res.status(404).json({ success: false, message: "Doctor not found or inactive." });
        }

        const baseFee = Number(doctor.fees?.clinic || 500);

        // 2. Resolve Chosen Slot Time (Supports both 'appointmentTime' and 'timeSlot' keys)
        const rawTime = String(appointmentTime || timeSlot || "").trim();
        const normalizedSlotTime = normalizeTo24Hour(rawTime);

        // 3. Look up Premium Surcharge in Availability
        let premiumSlotFee = 0;
        let isPremiumSlot = false;

        if (normalizedSlotTime) {
            const availability = await Availability.findOne({ vendorId: doctorId, vendorType: 'Doctor' }).lean();
            if (availability && Array.isArray(availability.premiumSlots)) {
                const matchedPremium = availability.premiumSlots.find(ps => normalizeTo24Hour(ps.time) === normalizedSlotTime);
                if (matchedPremium) {
                    premiumSlotFee = Math.max(0, Number(matchedPremium.extraFee || 0));
                    isPremiumSlot = premiumSlotFee > 0;
                }
            }
        }

        // Subtotal before coupon
        const subtotal = baseFee + premiumSlotFee;

        // 4. Coupon Validation
        let discount = 0;
        let appliedCoupon = null;

        if (couponCode && String(couponCode).trim() !== "") {
            const cleanCode = String(couponCode).trim().toUpperCase();
            const coupon = await Coupon.findOne({
                couponName: cleanCode,
                isActive: true,
                expiryDate: { $gte: new Date() },
                $or: [
                    { vendorId: hospitalId },
                    { vendorId: doctorId },
                    { isAdminCreated: true, vendorType: { $in: ['Hospital', 'Doctor', 'All'] } }
                ]
            }).lean();

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

        // 5. COD Status Check
        const codAvailable = await isCodEnabled('Hospital', userId);

        // Return comprehensive keys for frontend compatibility
        res.status(200).json({
            success: true,
            isCodAvailable: codAvailable,
            data: {
                consultationType: "OPD Clinic Visit",
                doctor: {
                    id: doctor._id,
                    name: doctor.name,
                    speciality: doctor.speciality,
                    roomNumber: doctor.department?.roomNumber || "Cabin 1"
                },
                hospital: {
                    id: doctor.hospitalId?._id || hospitalId,
                    name: doctor.hospitalId?.name || "Hospital",
                    city: doctor.hospitalId?.city || ""
                },
                slotDetails: {
                    appointmentDate: appointmentDate || moment().format('YYYY-MM-DD'),
                    appointmentTime: rawTime || "09:00 AM",
                    normalizedTime: normalizedSlotTime
                },
                pricing: {
                    baseFee: baseFee,                      // ₹650
                    doctorConsultationFee: baseFee,        // ₹650
                    originalBaseFee: baseFee,              // ₹650
                    premiumSlotFee: premiumSlotFee,        // ₹150 (Preserved!)
                    premiumSurcharge: premiumSlotFee,      // ₹150
                    extraCharges: premiumSlotFee,          // ₹150
                    isPremiumSlot: isPremiumSlot,          // true
                    subtotal: subtotal,                    // ₹800
                    discount: discount,                    // ₹0
                    totalPayable: totalPayable,            // ₹800 (Correct final total!)
                    totalAmount: totalPayable              // ₹800
                },
                appliedCoupon
            }
        });

    } catch (error) {
        console.error("Get Hospital OPD Checkout Summary Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// @desc    Book Hospital OPD Appointment with Token Generation & Razorpay / Counter Cash Handling
// @route   POST /user/hospital/opd/book
// @access  Private (User)
const bookHospitalOpdAppointment = async (req, res) => {
    try {
        const { 
            doctorId, 
            hospitalId, 
            appointmentDate, 
            appointmentTime, 
            timeSlot, 
            paymentMethod, 
            patients, 
            couponCode, 
            symptoms,
            bookingReason,
            insuranceDetails 
        } = req.body;

        const userId = req.user.id;

        if (!doctorId || !hospitalId) {
            return res.status(400).json({ success: false, message: "doctorId and hospitalId are required." });
        }

        // 1. Fetch Doctor
        const doctor = await Doctor.findById(doctorId).lean();
        if (!doctor || !doctor.isActive) {
            return res.status(404).json({ success: false, message: "Doctor not found or inactive." });
        }

        const baseFee = Number(doctor.fees?.clinic || 500);

        // 2. Resolve Chosen Time & Premium Surcharge
        const rawTime = String(appointmentTime || timeSlot || "09:00 AM").trim();
        const normalizedSlotTime = normalizeTo24Hour(rawTime);

        let premiumSlotFee = 0;
        if (normalizedSlotTime) {
            const availability = await Availability.findOne({ vendorId: doctorId, vendorType: 'Doctor' }).lean();
            if (availability && Array.isArray(availability.premiumSlots)) {
                const matchedPremium = availability.premiumSlots.find(ps => normalizeTo24Hour(ps.time) === normalizedSlotTime);
                if (matchedPremium) {
                    premiumSlotFee = Math.max(0, Number(matchedPremium.extraFee || 0));
                }
            }
        }

        const subtotal = baseFee + premiumSlotFee;

        // 3. Apply Coupon Discount if applicable
        let discount = 0;
        let appliedCouponDetails = null;

        if (couponCode && String(couponCode).trim() !== "") {
            const cleanCode = String(couponCode).trim().toUpperCase();
            const coupon = await Coupon.findOne({
                couponName: cleanCode,
                isActive: true,
                expiryDate: { $gte: new Date() }
            });

            if (coupon && subtotal >= (coupon.minOrderAmount || 0)) {
                discount = Math.min(Math.round((subtotal * coupon.discountPercentage) / 100), coupon.maxDiscount || subtotal);
                appliedCouponDetails = {
                    couponId: coupon._id,
                    couponCode: coupon.couponName,
                    discountValue: discount
                };
            }
        }

        const finalTotal = Math.max(0, subtotal - discount);

        // 4. Generate Daily Token Number Atomically
        const targetDate = appointmentDate ? moment(appointmentDate).toDate() : new Date();
        const startOfDay = moment(targetDate).startOf('day').toDate();
        const endOfDay = moment(targetDate).endOf('day').toDate();

        const countToday = await Appointment.countDocuments({
            hospitalId,
            doctorId,
            appointmentDate: { $gte: startOfDay, $lte: endOfDay },
            bookingType: 'OPD',
            tokenNumber: { $ne: null }
        });
        const assignedTokenNumber = countToday + 1;

        // 5. Build Patient Profile
        const patientData = (Array.isArray(patients) && patients.length > 0) ? patients : [{
            patientName: req.user.name || "Patient",
            patientAge: req.user.age || 28,
            gender: req.user.gender || "Male",
            relation: "Self",
            reasonForVisit: symptoms || bookingReason || "Routine OPD Consultation"
        }];

        const bookingId = `HK-OPD-${Date.now().toString().slice(-6)}`;

        // Normalize Payment Method
        const cleanMethod = String(paymentMethod || 'Online').toUpperCase() === 'COD' ? 'COD' : 'Online';

        // 6. Create Appointment Document in Database
        const appointment = await Appointment.create({
            userId,
            doctorId,
            hospitalId,
            bookingType: 'OPD',
            tokenNumber: assignedTokenNumber,
            opdRoomNumber: doctor.department?.roomNumber || "Cabin 1",
            appointmentDate: targetDate,
            appointmentTime: rawTime,
            patients: patientData,
            status: cleanMethod === 'COD' ? 'Confirmed' : 'Pending',
            paymentMethod: cleanMethod,
            paymentStatus: cleanMethod === 'COD' ? 'Pending' : 'Pending',
            totalAmount: finalTotal, // 🚨 Saved with ₹800 including surcharge!
            bookingId,
            pricingBreakdown: {
                baseFee: baseFee,
                originalBaseFee: baseFee,
                extraCharges: premiumSlotFee, // 🚨 ₹150 Surcharge Saved!
                discountAmount: discount,
                subtotal: subtotal,
                totalPayable: finalTotal
            },
            couponDetails: appliedCouponDetails,
            insuranceDetails: {
                hasInsurance: Boolean(insuranceDetails?.hasInsurance),
                companyName: insuranceDetails?.companyName || "",
                insuranceNumber: insuranceDetails?.insuranceNumber || ""
            }
        });

        // 7. If Online Payment -> Create Razorpay Order with Exact Surcharge Price
        if (cleanMethod === 'Online' && finalTotal > 0) {
            const rzpOrder = await createRazorpayOrder(finalTotal, `rcpt_${bookingId}`);
            
            appointment.paymentDetails = {
                razorpayOrderId: rzpOrder.id,
                amount: finalTotal,
                currency: 'INR',
                status: 'created'
            };
            await appointment.save();

            return res.status(201).json({
                success: true,
                isOnlinePayment: true,
                message: `OPD Appointment initiated. Token #${assignedTokenNumber} reserved. Complete payment of ₹${finalTotal} to confirm.`,
                key_id: process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID,
                amount: rzpOrder.amount, // in paise: 80000 = ₹800
                currency: "INR",
                razorpayOrderId: rzpOrder.id,
                appointmentId: appointment._id,
                bookingId: appointment.bookingId,
                tokenNumber: assignedTokenNumber,
                totalPayable: finalTotal
            });
        }

        // COD / Pay at Hospital Counter Flow
        res.status(201).json({
            success: true,
            isOnlinePayment: false,
            message: `OPD Token #${assignedTokenNumber} confirmed successfully! Pay ₹${finalTotal} at hospital reception counter.`,
            appointmentId: appointment._id,
            bookingId: appointment.bookingId,
            tokenNumber: assignedTokenNumber,
            totalPayable: finalTotal,
            data: appointment
        });

    } catch (error) {
        console.error("Book Hospital OPD Appointment Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get Live OPD Queue Status (Smart State Awareness for Completed, In-Progress & Waiting)
// @route   GET /user/hospital/opd/live-queue/:appointmentId
// @access  Private (User)
const getHospitalOpdLiveQueue = async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const userId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const query = isObjectId 
            ? { _id: appointmentId, userId, bookingType: 'OPD' } 
            : { bookingId: String(appointmentId).trim(), userId, bookingType: 'OPD' };

        const myAppt = await Appointment.findOne(query)
            .populate('hospitalId', 'name city phone address')
            .populate('doctorId', 'name speciality department fees slotDuration')
            .lean();

        if (!myAppt) {
            return res.status(404).json({ success: false, message: "OPD Appointment record not found." });
        }

        const apptDate = moment(myAppt.appointmentDate).startOf('day').toDate();
        const endOfDay = moment(myAppt.appointmentDate).endOf('day').toDate();

        // Fetch all tokens of this doctor on this day
        const todayTokens = await Appointment.find({
            hospitalId: myAppt.hospitalId._id,
            doctorId: myAppt.doctorId._id,
            bookingType: 'OPD',
            appointmentDate: { $gte: apptDate, $lte: endOfDay },
            status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital'] }
        }).sort({ tokenNumber: 1 }).select('tokenNumber status appointmentTime').lean();

        const activeConsultingAppt = todayTokens.find(t => t.status === 'In-Progress');
        const currentServingToken = activeConsultingAppt 
            ? activeConsultingAppt.tokenNumber 
            : (todayTokens.filter(t => t.status === 'Completed').length + 1);

        // Smart Status Representation (No misleading wait time if consultation is finished or ongoing)
        let queueStatusMessage = "Waiting in Queue";
        let patientsAhead = 0;
        let estimatedWaitMinutes = 0;

        if (myAppt.status === 'Completed') {
            queueStatusMessage = "Consultation Finished";
            patientsAhead = 0;
            estimatedWaitMinutes = 0;
        } else if (myAppt.status === 'In-Progress') {
            queueStatusMessage = "Your Turn! Inside Cabin with Doctor";
            patientsAhead = 0;
            estimatedWaitMinutes = 0;
        } else if (myAppt.status === 'No-Show') {
            queueStatusMessage = "Marked Absent / No-Show";
            patientsAhead = 0;
            estimatedWaitMinutes = 0;
        } else {
            patientsAhead = Math.max(0, (myAppt.tokenNumber || 1) - currentServingToken);
            estimatedWaitMinutes = patientsAhead * Number(myAppt.doctorId?.slotDuration || 15);
        }

        res.status(200).json({
            success: true,
            data: {
                bookingId: myAppt.bookingId,
                myTokenNumber: myAppt.tokenNumber,
                currentServingToken: activeConsultingAppt ? currentServingToken : Math.min(currentServingToken, todayTokens.length),
                patientsAhead,
                estimatedWaitTime: estimatedWaitMinutes > 0 ? `${estimatedWaitMinutes} mins` : "0 mins",
                queueStatusMessage,
                opdRoomNumber: myAppt.opdRoomNumber || myAppt.doctorId?.department?.roomNumber || null,
                doctorName: myAppt.doctorId?.name,
                doctorSpeciality: myAppt.doctorId?.speciality,
                hospitalName: myAppt.hospitalId?.name,
                status: myAppt.status,
                appointmentDate: moment(myAppt.appointmentDate).format('YYYY-MM-DD'),
                appointmentTime: myAppt.appointmentTime
            }
        });

    } catch (error) {
        console.error("Get Hospital OPD Live Queue Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Patient Fetches NMC-Formatted OPD Prescription for their Hospital Appointment
// @route   GET /user/hospital/opd/prescription/:appointmentId
// @access  Private (User)
const getUserOpdPrescription = async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const userId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const apptQuery = {
            userId,
            ...(isObjectId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(apptQuery)
            .populate('hospitalId', 'name address phone city hospitalImage')
            .populate('doctorId', 'name speciality qualification councilNumber department profileImage')
            .lean();

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment record not found for this user." });
        }

        // Fetch the digital prescription
        const prescription = await Prescription.findOne({ appointmentId: appointment._id }).lean();

        if (!prescription) {
            return res.status(404).json({ 
                success: false, 
                message: "Prescription has not been generated by the doctor yet." 
            });
        }

        res.status(200).json({
            success: true,
            data: {
                prescriptionId: prescription._id,
                appointment: {
                    id: appointment._id,
                    bookingId: appointment.bookingId,
                    tokenNumber: appointment.tokenNumber,
                    appointmentDate: appointment.appointmentDate,
                    appointmentTime: appointment.appointmentTime,
                    status: appointment.status
                },
                hospital: {
                    name: appointment.hospitalId?.name || "Hospital",
                    address: appointment.hospitalId?.address || "",
                    city: appointment.hospitalId?.city || "",
                    phone: appointment.hospitalId?.phone || "",
                    image: appointment.hospitalId?.hospitalImage?.[0] || null
                },
                doctor: {
                    name: appointment.doctorId?.name || "Doctor",
                    speciality: appointment.doctorId?.speciality || "Specialist",
                    qualification: appointment.doctorId?.qualification || "MBBS",
                    registrationNumber: appointment.doctorId?.councilNumber || "N/A",
                    cabinRoom: appointment.doctorId?.department?.roomNumber || "Cabin",
                    image: appointment.doctorId?.profileImage || null
                },
                patient: {
                    name: appointment.patients?.[0]?.patientName || req.user.name,
                    age: appointment.patients?.[0]?.patientAge || req.user.age || 30,
                    gender: appointment.patients?.[0]?.gender || req.user.gender || "Male"
                },
                clinicalInfo: {
                    chiefComplaints: prescription.chiefComplaints || "",
                    diagnosis: prescription.diagnosis || [],
                    vitals: prescription.vitals || appointment.clinicalSummary?.vitals || {},
                    advisedInvestigations: prescription.advisedInvestigations || "None",
                    adviceGiven: prescription.adviceGiven || "",
                    specialInstructions: prescription.specialInstructions || "",
                    nextAppointment: prescription.nextAppointment || ""
                },
                medicines: (prescription.medicines || []).map(m => ({
                    name: m.name,
                    strength: m.strength || "",
                    doseInterval: m.doseInterval || m.dose || "1-0-0",
                    frequency: m.frequency || "q.d.",
                    duration: m.duration || "5 days",
                    dispenseQuantity: m.dispenseQuantity || "10 Tablets",
                    administrationTiming: m.administrationTiming || m.instructions || "p.c. (After meals)",
                    isCustomGeneric: m.isCustomGeneric || false,
                    genericComposition: m.genericComposition || ""
                })),
                pdfUrl: prescription.pdfUrl || appointment.clinicalSummary?.dischargeSummaryPdf || null,
                dietPlanPdf: prescription.dietPlanPdf || null,
                generatedAt: prescription.createdAt
            }
        });

    } catch (error) {
        console.error("Get User OPD Prescription Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// @desc    Get Single Hospital Booking Full Details (OPD Token Slip or IPD Admission Sheet)
// @route   GET /user/hospital/booking-details/:id
// @access  Private (User)
const getHospitalBookingDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            userId,
            ...(isObjectId ? { _id: id } : { bookingId: String(id).trim() })
        };

        const booking = await Appointment.findOne(query)
            .populate('hospitalId', 'name address city state hospitalImage phone type location')
            .populate('doctorId', 'name speciality qualification profileImage fees department')
            .populate('ambulanceId', 'name vehicleNumber phone vehicleType')
            .populate({
                path: 'bedId',
                select: 'bedNumber status pricePerDay isVentilatorAvailable wardId',
                populate: { path: 'wardId', select: 'name type' }
            })
            .lean();

        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found or access denied." });
        }

        const isOPD = booking.bookingType === 'OPD';
        const isCOD = booking.paymentMethod === 'COD';
        const isPaid = booking.paymentStatus === 'Paid';

        // Destination display label
        let destinationLabel = "";
        if (isOPD) {
            destinationLabel = `${booking.hospitalId?.name || 'Hospital'} (${booking.opdRoomNumber || booking.doctorId?.department?.roomNumber || 'OPD Cabin'})`;
        } else {
            destinationLabel = `${booking.hospitalId?.name || 'Hospital'} (Bed: ${booking.bedNumber || 'Unassigned'}, ${booking.wardName || 'Ward'})`;
        }

        // Live Queue Estimate for OPD
        let currentServingToken = null;
        let patientsAhead = 0;
        let estimatedWaitTime = "";

        if (isOPD && booking.status === 'Confirmed') {
            const todayStart = moment(booking.appointmentDate).startOf('day').toDate();
            const todayEnd = moment(booking.appointmentDate).endOf('day').toDate();

            const todayTokens = await Appointment.find({
                hospitalId: booking.hospitalId?._id,
                doctorId: booking.doctorId?._id,
                bookingType: 'OPD',
                appointmentDate: { $gte: todayStart, $lte: todayEnd },
                status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital'] }
            }).sort({ tokenNumber: 1 }).select('tokenNumber status').lean();

            const activeAppt = todayTokens.find(t => t.status === 'In-Progress');
            currentServingToken = activeAppt ? activeAppt.tokenNumber : (todayTokens.filter(t => t.status === 'Completed').length + 1);
            patientsAhead = Math.max(0, (booking.tokenNumber || 1) - currentServingToken);
            estimatedWaitTime = `${patientsAhead * (booking.doctorId?.slotDuration || 15)} mins`;
        }

        res.status(200).json({
            success: true,
            data: {
                ...booking,
                isOpd: isOPD,
                isIpd: !isOPD,
                isCod,
                isPaid,
                paymentDisplayLabel: isCOD ? "Cash on Delivery" : (isPaid ? "Paid Online" : "Payment Pending"),
                destinationLabel,
                tokenDetails: isOPD ? {
                    tokenNumber: booking.tokenNumber,
                    opdRoomNumber: booking.opdRoomNumber || booking.doctorId?.department?.roomNumber || "Cabin 1",
                    currentServingToken,
                    patientsAhead,
                    estimatedWaitTime
                } : null,
                formattedDate: isOPD 
                    ? moment(booking.appointmentDate).format('DD MMM YYYY')
                    : `${moment(booking.startDate).format('DD MMM YYYY')} - ${moment(booking.endDate).format('DD MMM YYYY')}`,
                canCancel: !['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital'].includes(booking.status)
            }
        });

    } catch (error) {
        console.error("Get Hospital Booking Details Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};





// @desc    Get Details of Pending Admission Bed Hold with 30-Minute Live Countdown
// @route   GET /user/hospital/admission/pending-payment/:appointmentId
// @access  Private (User)
const getPendingAdmissionDetails = async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const userId = req.user.id;

        const appointment = await Appointment.findOne({ _id: appointmentId, userId })
            .populate('hospitalId', 'name address phone hospitalImage city')
            .populate('doctorId', 'name speciality department profileImage')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay isVentilatorAvailable wardId',
                populate: { path: 'wardId', select: 'name type' }
            })
            .lean();

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment record not found." });
        }

        const now = new Date();
        const holdDeadline = appointment.admissionHoldExpiresAt ? new Date(appointment.admissionHoldExpiresAt) : null;

        // Check if hold already expired
        if (holdDeadline && now > holdDeadline) {
            if (appointment.bedId) {
                await Bed.findByIdAndUpdate(appointment.bedId._id, { $set: { status: 'Available' } });
            }
            await Appointment.findByIdAndUpdate(appointmentId, {
                $set: { 
                    bedId: null, 
                    bedNumber: null, 
                    wardName: null, 
                    admissionHoldExpiresAt: null 
                }
            });

            return res.status(400).json({
                success: false,
                isExpired: true,
                message: "30-minute bed hold has expired. The bed has been released."
            });
        }

        const remainingMs = holdDeadline ? Math.max(0, holdDeadline.getTime() - now.getTime()) : 0;
        const remainingSeconds = Math.floor(remainingMs / 1000);

        res.status(200).json({
            success: true,
            isExpired: false,
            data: {
                appointmentId: appointment._id,
                bookingId: appointment.bookingId,
                hospital: appointment.hospitalId,
                doctor: appointment.doctorId,
                wardName: appointment.wardName || appointment.bedId?.wardId?.name,
                bedNumber: appointment.bedNumber || appointment.bedId?.bedNumber,
                pricePerDay: appointment.bedId?.pricePerDay || 1000,
                depositPayable: appointment.pricingBreakdown?.depositPaidOnBooking || appointment.bedId?.pricePerDay || 1000,
                holdExpiresAt: appointment.admissionHoldExpiresAt,
                remainingSeconds: remainingSeconds,
                formattedRemainingTime: `${Math.floor(remainingSeconds / 60)}m ${remainingSeconds % 60}s`,
                vitals: appointment.clinicalSummary?.vitals || null
            }
        });

    } catch (error) {
        console.error("Get Pending Admission Details Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// @desc    Generate Razorpay Order for Admission Deposit (Validates 30-min window)
// @route   POST /user/hospital/admission/create-payment-order
// @access  Private (User)
const createAdmissionPaymentOrder = async (req, res) => {
    try {
        const { appointmentId } = req.body;
        const userId = req.user.id;

        const appointment = await Appointment.findOne({ _id: appointmentId, userId });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Admission booking record not found." });
        }

        const now = new Date();

        // Check if 30-Minute Hold has expired
        if (appointment.admissionHoldExpiresAt && now > new Date(appointment.admissionHoldExpiresAt)) {
            if (appointment.bedId) {
                await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Available' } });
            }
            appointment.status = 'Cancelled-By-Hospital';
            await appointment.save();

            return res.status(400).json({
                success: false,
                isExpired: true,
                message: "Your 30-minute reservation window for this bed has expired. Please contact the hospital doctor to re-assign a bed."
            });
        }

        const totalPayable = Number(appointment.totalAmount || 1000);
        const receiptId = `ipd_rcpt_${appointment.bookingId || Date.now().toString().slice(-6)}`;

        // Generate Razorpay Order
        const rzpOrder = await createRazorpayOrder(totalPayable, receiptId);

        res.status(200).json({
            success: true,
            key_id: process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID,
            amount: rzpOrder.amount,
            currency: "INR",
            razorpayOrderId: rzpOrder.id,
            appointmentId: appointment._id,
            bookingId: appointment.bookingId,
            depositAmount: totalPayable,
            holdExpiresAt: appointment.admissionHoldExpiresAt
        });

    } catch (error) {
        console.error("Create Admission Order Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Verify Razorpay Payment Signature and Lock Bed (Guards against counter payment race condition)
// @route   POST /user/hospital/admission/verify-payment
// @access  Private (User)
const verifyAdmissionOnlinePayment = async (req, res) => {
    try {
        const { appointmentId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const userId = req.user.id;

        if (!appointmentId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ success: false, message: "Missing Razorpay payment verification parameters." });
        }

        const appointment = await Appointment.findOne({ _id: appointmentId, userId });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Admission record not found." });
        }

        // RACE CONDITION GUARD: Check if already paid at counter
        if (appointment.paymentStatus === 'Paid') {
            return res.status(400).json({ 
                success: false, 
                message: "Payment for this admission has already been completed (via counter or app). Bed is confirmed." 
            });
        }

        // Verify Signature
        const isSignatureValid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
        if (!isSignatureValid) {
            return res.status(400).json({ success: false, message: "Payment verification failed. Invalid signature." });
        }

        const now = new Date();
        const rzpDetails = await fetchAndMapRazorpayPayment(razorpay_payment_id, razorpay_signature);

        // Lock Bed to Occupied
        const bed = await Bed.findById(appointment.bedId);
        if (bed) {
            bed.status = 'Occupied';
            await bed.save();
            if (bed.wardId) {
                await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: -1 } });
            }
        }

        appointment.paymentStatus = 'Paid';
        appointment.paymentMethod = 'Online';
        appointment.status = 'In-Progress';
        appointment.admissionHoldExpiresAt = null; // Clear hold timer
        appointment.paymentDetails = rzpDetails || {
            razorpayPaymentId: razorpay_payment_id,
            razorpayOrderId: razorpay_order_id,
            razorpaySignature: razorpay_signature,
            method: 'Online',
            status: 'captured',
            paidAt: now
        };

        await appointment.save();

        res.status(200).json({
            success: true,
            message: "Online payment verified! Hospital admission confirmed and bed locked.",
            bookingId: appointment.bookingId,
            bedNumber: appointment.bedNumber,
            wardName: appointment.wardName,
            status: appointment.status,
            data: appointment
        });

    } catch (error) {
        console.error("Verify Admission Payment Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// @desc    Patient or Reception Declines Admission -> Bed Released Immediately Without Waiting 30 Mins
// @route   POST /user/hospital/admission/cancel-hold
// @access  Private (User or Hospital Admin)
const cancelAdmissionBedHold = async (req, res) => {
    try {
        const { appointmentId, reason } = req.body;

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment record not found." });
        }

        // Release the reserved bed immediately
        if (appointment.bedId) {
            await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Available' } });
        }

        // Clear bed hold without cancelling the OPD consultation
        appointment.bedId = null;
        appointment.bedNumber = null;
        appointment.wardName = null;
        appointment.admissionHoldExpiresAt = null;
        
        // Log patient decline in treatment notes
        appointment.treatmentHistory.push({
            action: 'Initial-Assignment',
            notes: `Admission declined by patient: "${reason || 'Patient opted out of hospital admission'}". Bed released immediately.`,
            timestamp: new Date()
        });

        await appointment.save();

        res.status(200).json({
            success: true,
            message: "Admission hold cancelled. Bed released back to available pool immediately.",
            data: appointment
        });

    } catch (error) {
        console.error("Cancel Admission Hold Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get Active Admission Hold for Patient (Powers Sticky Banner on Mobile Home Screen)
// @route   GET /user/hospital/admission/active-hold
// @access  Private (User)
const getActiveAdmissionHold = async (req, res) => {
    try {
        const userId = req.user.id;
        const now = new Date();

        const activeAdmission = await Appointment.findOne({
            userId,
            bookingType: 'Admission',
            status: 'Hospital-Pending',
            paymentStatus: 'Pending',
            admissionHoldExpiresAt: { $gt: now }
        })
        .populate('hospitalId', 'name city hospitalImage phone')
        .populate('doctorId', 'name speciality department')
        .lean();

        if (!activeAdmission) {
            return res.status(200).json({
                success: true,
                hasActiveHold: false,
                data: null
            });
        }

        const remainingMs = Math.max(0, new Date(activeAdmission.admissionHoldExpiresAt).getTime() - now.getTime());
        const remainingSeconds = Math.floor(remainingMs / 1000);

        res.status(200).json({
            success: true,
            hasActiveHold: true,
            data: {
                appointmentId: activeAdmission._id,
                bookingId: activeAdmission.bookingId,
                hospitalName: activeAdmission.hospitalId?.name || "Hospital",
                doctorName: activeAdmission.doctorId?.name || "Doctor",
                wardName: activeAdmission.wardName,
                bedNumber: activeAdmission.bedNumber,
                depositPayable: activeAdmission.totalAmount,
                holdExpiresAt: activeAdmission.admissionHoldExpiresAt,
                remainingSeconds: remainingSeconds,
                formattedRemainingTime: `${Math.floor(remainingSeconds / 60)}m ${remainingSeconds % 60}s`
            }
        });

    } catch (error) {
        console.error("Get Active Admission Hold Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};



module.exports = {
    getHospitals, getWards, getBedGrid, getDoctorsByHospitalId, getServicesByHospitalId, getHospitalCoupons, validateHospitalCoupon,
    getAvailableBedsForRange,cancelBedBooking, rescheduleBedBooking, getBedMonthlySchedule, rateHospitalAdmission,
    getHospitalCheckoutSummary, finalHospitalBooking,verifyHospitalPayment, getMyHospitalBookings, getBookingProfiles,
    getHospitalDetails, addReview, updateReview,
    // OPD Related Controllers
    getHospitalDoctorOpdSlots, getHospitalOpdCheckoutSummary, bookHospitalOpdAppointment,getHospitalOpdLiveQueue,getUserOpdPrescription,getHospitalBookingDetails,
    // Admission Related Controllers
    createAdmissionPaymentOrder, verifyAdmissionOnlinePayment,getPendingAdmissionDetails,cancelAdmissionBedHold,getActiveAdmissionHold
};