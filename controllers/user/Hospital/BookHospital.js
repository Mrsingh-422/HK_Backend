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
const { syncHospitalWardAndBedCapacity } = require('../../../utils/helpers');


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

// @desc    Get Hospital Wards with 100% Accurate Dynamic Available Bed Counts
// @route   GET /user/hospital/wards?hospitalId=...
// @access  Public
const getWards = async (req, res) => {
    try {
        const { hospitalId } = req.query;

        if (!hospitalId || !mongoose.isValidObjectId(hospitalId)) {
            return res.status(400).json({ success: false, message: "Valid hospitalId query parameter is required." });
        }

        // Auto-sync wards before returning
        await syncHospitalWardAndBedCapacity(hospitalId);

        const wards = await Ward.find({ hospitalId, isActive: true }).lean();

        const formatted = wards.map(w => ({
            _id: w._id,
            name: w.name,
            type: w.type,
            totalBeds: w.totalBeds || 0,
            availableBeds: Math.max(0, w.availableBeds || 0),
            hasAvailability: (w.availableBeds || 0) > 0
        }));

        res.status(200).json({
            success: true,
            count: formatted.length,
            data: formatted
        });
    } catch (error) {
        console.error("Get Wards User Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// @desc    Get Real-Time Bed Grid for Ward (Instant Lean Fetch)
// @route   GET /user/hospital/bed-grid/:wardId
// @access  Public
const getBedGrid = async (req, res) => {
    try {
        const { wardId } = req.params;

        if (!mongoose.isValidObjectId(wardId)) {
            return res.status(400).json({ success: false, message: "Invalid wardId format." });
        }

        const [ward, beds] = await Promise.all([
            Ward.findById(wardId).select('name type totalBeds availableBeds').lean(),
            Bed.find({ wardId })
                .select('_id bedNumber pricePerDay isVentilatorAvailable status')
                .sort({ bedNumber: 1 })
                .lean()
        ]);

        if (!ward) {
            return res.status(404).json({ success: false, message: "Ward not found." });
        }

        return res.status(200).json({
            success: true,
            wardName: ward.name,
            wardType: ward.type,
            totalBeds: beds.length,
            availableBeds: beds.filter(b => b.status === 'Available').length,
            data: beds
        });

    } catch (error) {
        console.error("Fast Get Bed Grid Error:", error);
        return res.status(500).json({ success: false, message: error.message });
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





// @desc    Check Bed Availability for Specific Date Range (Ultra-Fast 2-Query In-Memory Matching)
// @route   POST /user/hospital/check-availability
// @access  Public
const getAvailableBedsForRange = async (req, res) => {
    try {
        const { hospitalId, wardId, startDate, endDate } = req.body;

        if (!hospitalId || !wardId || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: "hospitalId, wardId, startDate, and endDate are all required."
            });
        }

        const startMoment = moment(startDate).startOf('day');
        const endMoment = moment(endDate).endOf('day');

        if (!startMoment.isValid() || !endMoment.isValid() || endMoment.isBefore(startMoment)) {
            return res.status(400).json({
                success: false,
                message: "Invalid dates. endDate must be on or after startDate."
            });
        }

        const now = new Date();
        const hospObjId = new mongoose.Types.ObjectId(hospitalId);
        const wardObjId = new mongoose.Types.ObjectId(wardId);

        // 1. Parallel Fetch: Beds + Conflicting Appointments in parallel (Zero waiting)
        const [allBeds, conflictingAppointments] = await Promise.all([
            Bed.find({ wardId: wardObjId, hospitalId: hospObjId })
                .select('_id bedNumber pricePerDay isVentilatorAvailable status')
                .sort({ bedNumber: 1 })
                .lean(),

            Appointment.find({
                hospitalId: hospObjId,
                wardId: wardObjId,
                bookingType: 'Admission',
                status: { $in: ['In-Progress', 'Discharge-Pending', 'Confirmed', 'Hospital-Pending'] },
                $or: [
                    {
                        status: { $in: ['In-Progress', 'Discharge-Pending', 'Confirmed'] },
                        startDate: { $lte: endMoment.toDate() },
                        endDate: { $gte: startMoment.toDate() }
                    },
                    {
                        status: 'Hospital-Pending',
                        admissionHoldExpiresAt: { $gt: now },
                        startDate: { $lte: endMoment.toDate() },
                        endDate: { $gte: startMoment.toDate() }
                    }
                ]
            }).select('bedId status').lean()
        ]);

        if (allBeds.length === 0) {
            return res.status(404).json({ success: false, message: "No beds found in this ward." });
        }

        // 2. In-Memory Map (O(1) instant lookup)
        const conflictMap = new Map();
        conflictingAppointments.forEach(a => {
            if (a.bedId) conflictMap.set(String(a.bedId), a.status);
        });

        const isQueryingToday = startMoment.isSameOrBefore(moment().endOf('day'));

        // 3. Instant compute array
        let availableCount = 0;
        const computedGrid = allBeds.map(bed => {
            const bIdStr = String(bed._id);
            let finalStatus = 'Available';

            if (bed.status === 'Maintenance') {
                finalStatus = 'Maintenance';
            } else if (conflictMap.has(bIdStr)) {
                const s = conflictMap.get(bIdStr);
                finalStatus = (s === 'In-Progress' || s === 'Discharge-Pending') ? 'Occupied' : 'Reserved';
            } else if (bed.status === 'Occupied' && isQueryingToday) {
                finalStatus = 'Occupied';
            }

            const isAvailable = finalStatus === 'Available';
            if (isAvailable) availableCount++;

            return {
                _id: bed._id,
                bedNumber: bed.bedNumber,
                pricePerDay: bed.pricePerDay,
                isVentilatorAvailable: Boolean(bed.isVentilatorAvailable),
                status: finalStatus,
                isAvailable
            };
        });

        return res.status(200).json({
            success: true,
            wardId,
            queryRange: {
                startDate: startMoment.format('YYYY-MM-DD'),
                endDate: endMoment.format('YYYY-MM-DD')
            },
            totalBeds: computedGrid.length,
            availableBedsCount: availableCount,
            data: computedGrid
        });

    } catch (error) {
        console.error("Fast Check Bed Availability Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// for conditional subcription plan check, we will use the middleware requireConditionPlan in the routes for specialized disease care bookings. This middleware will ensure that only users with an active subscription for the required disease care plan can access the booking endpoints.
// @desc    Calculate IPD Admission Checkout Bill Summary (Resolves Special Services & Stay Duration)
// @route   POST /user/hospital/checkout-summary
// @access  Private (User)
const getHospitalCheckoutSummary = async (req, res) => {
    try {
        let { hospitalId, bedId, startDate, endDate, specialServices, couponCode } = req.body;

        if (!hospitalId || !bedId || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: "hospitalId, bedId, startDate, and endDate are required."
            });
        }

        const startMoment = moment(startDate).startOf('day');
        const endMoment = moment(endDate).endOf('day');

        if (!startMoment.isValid() || !endMoment.isValid() || endMoment.isBefore(startMoment)) {
            return res.status(400).json({
                success: false,
                message: "Invalid dates. endDate must be on or after startDate."
            });
        }

        const stayDays = Math.max(1, endMoment.diff(startMoment, 'days') + 1);

        const targetBed = await Bed.findOne({ _id: bedId, hospitalId }).populate('wardId').lean();
        if (!targetBed) {
            return res.status(404).json({ success: false, message: "Selected bed not found in this hospital." });
        }

        const bedRate = Number(targetBed.pricePerDay || 1000);
        const baseStayFee = bedRate * stayDays;

        // 🚨 RESOLVE SPECIAL SERVICES SAFELY (Handles String IDs, Arrays, or Objects)
        let resolvedServicesList = [];
        let specialServicesTotal = 0;

        if (specialServices) {
            let parsed = specialServices;
            if (typeof specialServices === 'string') {
                try { parsed = JSON.parse(specialServices); } catch (e) { parsed = [specialServices.trim()]; }
            }
            if (!Array.isArray(parsed)) parsed = [parsed];

            const serviceIdsToQuery = [];
            for (const item of parsed) {
                if (typeof item === 'string' && mongoose.isValidObjectId(item.trim())) {
                    serviceIdsToQuery.push(new mongoose.Types.ObjectId(item.trim()));
                } else if (item && typeof item === 'object') {
                    const rawId = item.serviceId || item._id || item.id;
                    if (rawId && mongoose.isValidObjectId(String(rawId).trim()) && !item.serviceName) {
                        serviceIdsToQuery.push(new mongoose.Types.ObjectId(String(rawId).trim()));
                    } else if (item.serviceName) {
                        resolvedServicesList.push({
                            serviceName: String(item.serviceName).trim(),
                            price: Number(item.price || 0)
                        });
                        specialServicesTotal += Number(item.price || 0);
                    }
                }
            }

            if (serviceIdsToQuery.length > 0) {
                const dbServices = await HospitalService.find({ _id: { $in: serviceIdsToQuery } }).lean();
                dbServices.forEach(srv => {
                    resolvedServicesList.push({
                        serviceId: srv._id,
                        serviceName: srv.serviceName,
                        price: Number(srv.price || 0)
                    });
                    specialServicesTotal += Number(srv.price || 0);
                });
            }
        }

        // Coupon calculation
        let couponDiscount = 0;
        let appliedCoupon = null;
        if (couponCode) {
            const cleanCode = String(couponCode).trim().toUpperCase();
            const coupon = await Coupon.findOne({
                couponName: cleanCode,
                vendorType: { $in: ['Hospital', 'All'] },
                isActive: true,
                expiryDate: { $gte: new Date() }
            });

            if (coupon && baseStayFee >= (coupon.minOrderAmount || 0)) {
                couponDiscount = Math.min((baseStayFee * coupon.discountPercentage) / 100, coupon.maxDiscount || Infinity);
                appliedCoupon = {
                    couponId: coupon._id,
                    couponCode: coupon.couponName,
                    discountAmount: couponDiscount
                };
            }
        }

        const subtotal = baseStayFee + specialServicesTotal;
        const totalPayable = Math.max(0, subtotal - couponDiscount);

        return res.status(200).json({
            success: true,
            data: {
                wardName: targetBed.wardId?.name || "Ward",
                bedNumber: targetBed.bedNumber,
                pricePerDay: bedRate,
                days: stayDays,
                baseFee: baseStayFee,
                specialServicesCharges: specialServicesTotal,
                specialServices: resolvedServicesList,
                subtotal: subtotal,
                discount: couponDiscount,
                appliedCoupon,
                totalPayable: totalPayable
            }
        });

    } catch (error) {
        console.error("Get Hospital Checkout Summary Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};


// @desc    Finalize Hospital IPD Admission Booking (Crash-Proof Special Services Resolver & Form-Data Parser)
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
            appointmentDate,
            bookingType = 'Admission',
            triageLevel = 'Routine',
            bookingReason,
            patients,
            address,
            pricing,
            paymentMethod = 'COD',
            couponCode,
            specialServices,
            hasInsurance,
            insuranceNumber,
            companyName,
            insuranceType,
            masterInsuranceId
        } = req.body;

        // 1. Mandatory validations
        if (!hospitalId || !bedId || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: "hospitalId, bedId, startDate, and endDate are required."
            });
        }

        if (!mongoose.isValidObjectId(hospitalId) || !mongoose.isValidObjectId(bedId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid hospitalId or bedId format."
            });
        }

        // 2. Safe Parsing for Multipart Form-Data Strings
        const safeJsonParse = (input, fallback) => {
            if (!input) return fallback;
            if (typeof input === 'object') return input;
            try {
                return JSON.parse(input);
            } catch (e) {
                return fallback;
            }
        };

        const parsedPatients = safeJsonParse(patients, []);
        const parsedAddress = safeJsonParse(address, {});
        const parsedPricing = safeJsonParse(pricing, {});

        // 3. Normalize Date Boundaries
        const startMoment = moment(startDate).startOf('day');
        const endMoment = moment(endDate).endOf('day');

        if (!startMoment.isValid() || !endMoment.isValid() || endMoment.isBefore(startMoment)) {
            return res.status(400).json({
                success: false,
                message: "Invalid dates. endDate must be on or after startDate."
            });
        }

        const stayDurationDays = Math.max(1, endMoment.diff(startMoment, 'days') + 1);

        // 4. Verify Target Hospital and Bed
        const hospital = await Hospital.findById(hospitalId);
        if (!hospital || !hospital.isActive) {
            return res.status(404).json({ success: false, message: "Hospital not found or inactive." });
        }

        const targetBed = await Bed.findOne({ _id: bedId, hospitalId }).populate('wardId');
        if (!targetBed) {
            return res.status(404).json({ success: false, message: "Bed not found in the selected hospital." });
        }

        if (targetBed.status === 'Maintenance') {
            return res.status(400).json({
                success: false,
                message: "This bed is currently under maintenance. Please select another bed."
            });
        }

        // 5. Overlap Collision Check (Ensure bed is not double-booked)
        const now = new Date();
        const existingConflict = await Appointment.findOne({
            hospitalId,
            bedId,
            bookingType: 'Admission',
            status: { $in: ['Hospital-Pending', 'Confirmed', 'In-Progress', 'Discharge-Pending'] },
            $or: [
                {
                    status: { $in: ['In-Progress', 'Discharge-Pending', 'Confirmed'] },
                    startDate: { $lte: endMoment.toDate() },
                    endDate: { $gte: startMoment.toDate() }
                },
                {
                    status: 'Hospital-Pending',
                    admissionHoldExpiresAt: { $gt: now },
                    startDate: { $lte: endMoment.toDate() },
                    endDate: { $gte: startMoment.toDate() }
                }
            ]
        });

        if (existingConflict) {
            return res.status(400).json({
                success: false,
                message: "Selected bed has already been reserved or occupied for these dates. Please choose another bed."
            });
        }

        // =========================================================================
        // 🚨 6. BULLETPROOF SPECIAL SERVICES RESOLVER (Fixes CastError)
        // =========================================================================
        let formattedSpecialServices = [];
        if (specialServices) {
            let parsedSpecialServices = specialServices;

            // Handle stringified JSON from multipart form-data
            if (typeof specialServices === 'string') {
                try {
                    parsedSpecialServices = JSON.parse(specialServices);
                } catch (e) {
                    // Raw string ID like "6a415595feafd725c1599832"
                    parsedSpecialServices = [specialServices.trim()];
                }
            }

            if (!Array.isArray(parsedSpecialServices)) {
                parsedSpecialServices = [parsedSpecialServices];
            }

            const serviceIdsToQuery = [];

            for (const item of parsedSpecialServices) {
                // Case A: Item is a raw ObjectId String (e.g. "6a415595feafd725c1599832")
                if (typeof item === 'string' && mongoose.isValidObjectId(item.trim())) {
                    serviceIdsToQuery.push(new mongoose.Types.ObjectId(item.trim()));
                }
                // Case B: Item is an Object
                else if (item && typeof item === 'object') {
                    // Object with only serviceId / id
                    const rawId = item.serviceId || item._id || item.id;
                    if (rawId && mongoose.isValidObjectId(String(rawId).trim()) && !item.serviceName) {
                        serviceIdsToQuery.push(new mongoose.Types.ObjectId(String(rawId).trim()));
                    }
                    // Pre-formatted object with serviceName and price
                    else if (item.serviceName) {
                        formattedSpecialServices.push({
                            serviceId: rawId && mongoose.isValidObjectId(String(rawId).trim()) ? new mongoose.Types.ObjectId(String(rawId).trim()) : null,
                            serviceName: String(item.serviceName).trim(),
                            price: Number(item.price || 0)
                        });
                    }
                }
            }

            // Database lookup for any IDs sent by frontend
            if (serviceIdsToQuery.length > 0) {
                const fetchedServices = await HospitalService.find({ _id: { $in: serviceIdsToQuery } }).lean();
                fetchedServices.forEach(srv => {
                    formattedSpecialServices.push({
                        serviceId: srv._id,
                        serviceName: srv.serviceName,
                        price: Number(srv.price || 0)
                    });
                });
            }
        }

        // 7. Calculate Pricing & Surcharges
        const bedRatePerDay = Number(targetBed.pricePerDay || 1000);
        const stayBaseFee = bedRatePerDay * stayDurationDays;
        const specialServicesTotal = formattedSpecialServices.reduce((sum, s) => sum + (Number(s.price) || 0), 0);

        let couponDiscount = 0;
        let appliedCouponDoc = null;

        if (couponCode) {
            const cleanCoupon = String(couponCode).trim().toUpperCase();
            const coupon = await Coupon.findOne({
                couponName: cleanCoupon,
                vendorType: { $in: ['Hospital', 'All'] },
                isActive: true,
                expiryDate: { $gte: now }
            });

            if (coupon && stayBaseFee >= (coupon.minOrderAmount || 0)) {
                couponDiscount = Math.min((stayBaseFee * coupon.discountPercentage) / 100, coupon.maxDiscount || Infinity);
                appliedCouponDoc = {
                    couponId: coupon._id,
                    couponCode: coupon.couponName,
                    discountValue: couponDiscount
                };
            }
        }

        const subtotal = stayBaseFee + specialServicesTotal;
        const totalAmount = Math.max(0, subtotal - couponDiscount);

        // 8. Generate Unique Booking ID
        const timePart = Date.now().toString(36).toUpperCase();
        const randPart = crypto.randomBytes(2).toString('hex').toUpperCase();
        const generatedBookingId = `HKH-ADM-${timePart}-${randPart}`;

        // 9. Handle Insurance File Uploads (From Multer fields)
        const files = req.files || {};
        let insuranceDoc = null;
        let insuranceDocFront = null;
        let insuranceDocBack = null;

        if (files.insuranceDocument && files.insuranceDocument[0]) {
            insuranceDoc = `/uploads/insurance/${files.insuranceDocument[0].filename}`;
        }
        if (files.insuranceDocumentFront && files.insuranceDocumentFront[0]) {
            insuranceDocFront = `/uploads/insurance/${files.insuranceDocumentFront[0].filename}`;
        }
        if (files.insuranceDocumentBack && files.insuranceDocumentBack[0]) {
            insuranceDocBack = `/uploads/insurance/${files.insuranceDocumentBack[0].filename}`;
        }

        const hasInsuranceBoolean = hasInsurance === true || hasInsurance === 'true';

        // 10. Format Patients List
        let formattedPatients = [];
        if (Array.isArray(parsedPatients) && parsedPatients.length > 0) {
            formattedPatients = parsedPatients.map(p => ({
                patientName: p.patientName || p.name || req.user.name || "Patient",
                patientAge: Number(p.patientAge || p.age || 30),
                gender: p.gender || "Male",
                relation: p.relation || "Self",
                reasonForVisit: p.reasonForVisit || bookingReason || "Hospital Admission",
                bloodGroup: p.bloodGroup || null,
                isMainUser: Boolean(p.isMainUser)
            }));
        } else {
            formattedPatients = [{
                patientName: req.user.name || "Patient",
                patientAge: Number(req.user.age || 30),
                gender: req.user.gender || "Male",
                relation: "Self",
                reasonForVisit: bookingReason || "Hospital Admission",
                bloodGroup: req.user.bloodGroup || null,
                isMainUser: true
            }];
        }

        // 11. Normalize Payment Method & Status
        const cleanPaymentMethod = String(paymentMethod).toUpperCase() === 'ONLINE' ? 'Online' : 'COD';
        const isOnline = cleanPaymentMethod === 'Online';
        const initialStatus = 'Hospital-Pending';
        const initialPaymentStatus = 'Pending';

        // 30-minute hold window for payment completion or hospital confirmation
        const holdDeadline = new Date(now.getTime() + 30 * 60 * 1000);

        // 12. Create Appointment Document
        const appointment = await Appointment.create({
            userId,
            hospitalId,
            bedId: targetBed._id,
            bookingType: 'Admission',
            bedBookingType: triageLevel === 'Emergency' ? 'Emergency-Bed' : 'General-Bed',
            bookingId: generatedBookingId,
            status: initialStatus,
            triageLevel: triageLevel || 'Routine',
            bookingReason: bookingReason || "Hospital In-Patient Admission",
            wardName: targetBed.wardId?.name || "General Ward",
            bedNumber: targetBed.bedNumber,
            startDate: startMoment.toDate(),
            endDate: endMoment.toDate(),
            appointmentDate: startMoment.toDate(),
            stayDuration: stayDurationDays,
            admissionHoldExpiresAt: holdDeadline,
            patients: formattedPatients,
            address: {
                name: parsedAddress.name || formattedPatients[0].patientName,
                phone: parsedAddress.phone || req.user.phone || "",
                houseNo: parsedAddress.houseNo || "",
                sector: parsedAddress.sector || "",
                landmark: parsedAddress.landmark || "",
                city: parsedAddress.city || hospital.city || "",
                state: parsedAddress.state || hospital.state || "",
                pincode: parsedAddress.pincode || "",
                addressType: parsedAddress.addressType || "Home"
            },
            specialServices: formattedSpecialServices, // 👈 100% Resolved Object Array
            pricingBreakdown: {
                baseFee: stayBaseFee,
                originalBaseFee: stayBaseFee,
                visitCharges: 0,
                extraCharges: specialServicesTotal,
                discountAmount: couponDiscount,
                subtotal: subtotal,
                depositPaidOnBooking: totalAmount,
                bookedDurationDays: stayDurationDays
            },
            totalAmount: totalAmount,
            paymentMethod: cleanPaymentMethod,
            paymentStatus: initialPaymentStatus,
            couponDetails: appliedCouponDoc,
            insuranceDetails: {
                hasInsurance: hasInsuranceBoolean,
                insuranceNumber: insuranceNumber || "",
                companyName: companyName || "",
                insuranceType: insuranceType || "",
                masterInsuranceId: masterInsuranceId && mongoose.isValidObjectId(masterInsuranceId) ? masterInsuranceId : null,
                insuranceDocument: insuranceDoc,
                insuranceDocumentFront: insuranceDocFront,
                insuranceDocumentBack: insuranceDocBack,
                approvalStatus: 'Pending'
            }
        });

        // 13. Temporarily mark Bed status as Reserved during the active hold
        targetBed.status = 'Reserved';
        await targetBed.save();

        // 14. Auto-sync hospital bed capacity
        await syncHospitalWardAndBedCapacity(hospitalId, targetBed.wardId?._id);

        // 15. Online Razorpay Order generation if paymentMethod is Online
        let razorpayOrderData = null;
        if (isOnline && totalAmount > 0) {
            try {
                const rzpOrder = await createRazorpayOrder(totalAmount, `rcpt_${generatedBookingId}`);
                razorpayOrderData = {
                    key_id: process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID,
                    amount: rzpOrder.amount,
                    currency: "INR",
                    razorpayOrderId: rzpOrder.id
                };
            } catch (rzpErr) {
                console.error("Razorpay Order Generation Failed:", rzpErr.message);
            }
        }

        // 16. Alert Hospital Admin via Push Notification
        try {
            await sendPushNotification(
                hospitalId,
                'hospital',
                "New IPD Admission Booking!",
                `Patient ${formattedPatients[0].patientName} requested Bed ${targetBed.bedNumber} (${targetBed.wardId?.name}). Total Deposit: ₹${totalAmount}.`,
                { appointmentId: appointment._id.toString(), bookingId: generatedBookingId, type: 'new_admission_booking' }
            );
        } catch (e) {}

        return res.status(201).json({
            success: true,
            message: "Admission booking created successfully. Bed reserved under active hold.",
            bookingId: generatedBookingId,
            appointmentId: appointment._id,
            totalAmount: totalAmount,
            paymentMethod: cleanPaymentMethod,
            holdExpiresAt: holdDeadline,
            razorpayOrder: razorpayOrderData,
            data: appointment
        });

    } catch (error) {
        console.error("Final Hospital Booking Critical Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error: " + error.message
        });
    }
};



// @desc    Verify Online Razorpay Payment for IPD Bed Admission / OPD Booking
// @route   POST /user/hospital/verify-payment
// @access  Private (User)
const verifyHospitalPayment = async (req, res) => {
    try {
        const { appointmentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
        const userId = req.user.id;

        if (!appointmentId || !razorpayPaymentId) {
            return res.status(400).json({
                success: false,
                message: "appointmentId and razorpayPaymentId are required."
            });
        }

        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const query = {
            userId,
            ...(isObjectId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(query);
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment record not found." });
        }

        // 1. Signature Verification
        let isVerified = false;
        if (razorpayOrderId && razorpaySignature) {
            isVerified = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        }

        if (!isVerified && (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV)) {
            isVerified = true; // Development bypass
        }

        if (!isVerified && process.env.NODE_ENV === 'production') {
            return res.status(400).json({ success: false, message: "Invalid payment signature verification failed." });
        }

        // 2. Fetch payment details from Razorpay
        let rzpDetails = null;
        try {
            if (razorpaySignature) {
                rzpDetails = await fetchAndMapRazorpayPayment(razorpayPaymentId, razorpaySignature);
            }
        } catch (e) {}

        if (!rzpDetails) {
            rzpDetails = {
                razorpayPaymentId,
                razorpayOrderId: razorpayOrderId || "",
                razorpaySignature: razorpaySignature || "",
                method: 'Online',
                amount: appointment.totalAmount,
                currency: 'INR',
                status: 'captured',
                paidAt: new Date()
            };
        }

        // 3. Mark Booking as Confirmed and Paid
        appointment.paymentStatus = 'Paid';
        appointment.status = 'Confirmed';
        appointment.paymentDetails = rzpDetails;
        
        // Clear 30-minute hold deadline so background cron job does NOT release a paid booking
        appointment.admissionHoldExpiresAt = null;

        await appointment.save();

        // 4. Ensure Bed is locked to 'Reserved' and Ward counts are synced
        if (appointment.bedId) {
            await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Reserved' } });
            await syncHospitalWardAndBedCapacity(appointment.hospitalId);
        }

        // 5. Notify Hospital Admin of successful payment
        if (appointment.hospitalId) {
            try {
                await sendPushNotification(
                    appointment.hospitalId,
                    'hospital',
                    "💰 Admission Deposit Paid Online!",
                    `Patient ${appointment.patients[0]?.patientName} completed payment of ₹${appointment.totalAmount} for Booking #${appointment.bookingId}. Bed ${appointment.bedNumber} confirmed.`,
                    { appointmentId: appointment._id.toString(), bookingId: appointment.bookingId, type: 'admission_deposit_paid' }
                );
            } catch (notifErr) {}
        }

        return res.status(200).json({
            success: true,
            message: "Payment verified successfully. Booking confirmed and bed locked.",
            bookingId: appointment.bookingId,
            status: appointment.status,
            paymentStatus: appointment.paymentStatus,
            data: appointment
        });

    } catch (error) {
        console.error("Verify Hospital Payment Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error: " + error.message
        });
    }
};


// @desc    Cancel Bed Admission by Patient (Enforces Cancellation Policy & Releases Bed Capacity)
// @route   PATCH /user/hospital/cancel/:id
// @access  Private (User)
const cancelBedBooking = async (req, res) => {
    try {
        const appointmentId = req.params.id;
        const userId = req.user.id;
        const { reason } = req.body;

        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const query = {
            userId,
            bookingType: 'Admission',
            ...(isObjectId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(query);
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Bed booking not found or unauthorized." });
        }

        if (['Completed', 'Cancelled-By-User', 'Cancelled-By-Hospital'].includes(appointment.status)) {
            return res.status(400).json({ success: false, message: `Booking is already in '${appointment.status}' state.` });
        }

        // 1. Calculate cancellation refund and penalty using unified policy helper
        const refundReport = await processCancellationRefund(appointment, 'Hospital');
        const cancellationFee = refundReport.cancellationFee || 0;
        const refundAmount = refundReport.refundAmount || 0;

        appointment.status = 'Cancelled-By-User';

        if (appointment.paymentStatus === 'Paid') {
            appointment.paymentStatus = 'Refund-Initiated';
        }

        if (!appointment.pricingBreakdown) appointment.pricingBreakdown = {};
        appointment.pricingBreakdown.cancellationFeeApplied = cancellationFee;

        appointment.cancellationDetails = {
            cancelledBy: userId,
            reason: reason || "Cancelled by patient from mobile app.",
            cancelledAt: new Date(),
            isPermanent: true,
            refundAmountCalculated: refundAmount,
            penaltyApplied: cancellationFee
        };

        const targetBedId = appointment.bedId;
        const hospitalId = appointment.hospitalId;

        // 2. Release Bed immediately
        if (targetBedId) {
            await Bed.findByIdAndUpdate(targetBedId, { $set: { status: 'Available' } });
        }

        await appointment.save();

        // 3. Auto-sync hospital bed tallies
        if (hospitalId) {
            await syncHospitalWardAndBedCapacity(hospitalId);
        }

        // 4. Alert Hospital Reception
        if (hospitalId) {
            try {
                await sendPushNotification(
                    hospitalId,
                    'hospital',
                    "Bed Booking Cancelled",
                    `Booking #${appointment.bookingId} for Bed ${appointment.bedNumber} was cancelled by patient. Bed is now available.`,
                    { appointmentId: appointment._id.toString(), type: 'admission_cancelled_by_user' }
                );
            } catch (e) {}
        }

        return res.status(200).json({
            success: true,
            message: `Bed admission cancelled successfully. Refund of ₹${refundAmount} initiated (Cancellation fee: ₹${cancellationFee}).`,
            cancellationFee,
            refundAmount,
            data: appointment
        });

    } catch (error) {
        console.error("Cancel Bed Booking Error:", error);
        return res.status(500).json({ success: false, message: error.message });
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

// @desc    Get Hospital Doctor OPD Slots (Checks Approved Leaves & Existing Bookings)
// @route   GET /user/hospital/doctors/:doctorId/opd-slots?date=YYYY-MM-DD
// @access  Public
const getHospitalDoctorOpdSlots = async (req, res) => {
    try {
        const { doctorId } = req.params;
        const { date } = req.query;

        if (!doctorId || !date) {
            return res.status(400).json({ success: false, message: "doctorId and date (YYYY-MM-DD) are required." });
        }

        const queryMoment = moment(date, 'YYYY-MM-DD');
        if (!queryMoment.isValid()) {
            return res.status(400).json({ success: false, message: "Invalid date format. Expected 'YYYY-MM-DD'." });
        }

        const doctor = await Doctor.findById(doctorId).select('name department slotDuration availability leaves consultationStatus fees').lean();
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found." });
        }

        // 🚨 1. CHECK APPROVED DOCTOR LEAVES: Block entire day if doctor is on approved leave
        const targetDay = queryMoment.startOf('day').toDate();
        const isOnApprovedLeave = Array.isArray(doctor.leaves) && doctor.leaves.some(l => 
            l.status === 'Approved' &&
            moment(targetDay).isBetween(moment(l.startDate).startOf('day'), moment(l.endDate).endOf('day'), null, '[]')
        );

        if (isOnApprovedLeave) {
            return res.status(200).json({
                success: true,
                isDoctorOnLeave: true,
                message: `Dr. ${doctor.name} is on approved leave on ${date}. No OPD slots available.`,
                slots: []
            });
        }

        // 2. Check weekly schedule (e.g. Mon, Tue)
        const dayShort = queryMoment.format('ddd'); // 'Mon', 'Tue'
        const dayConfig = (doctor.availability || []).find(a => a.day === dayShort);

        if (!dayConfig || !dayConfig.startTime || !dayConfig.endTime) {
            return res.status(200).json({
                success: true,
                isClosed: true,
                message: `Dr. ${doctor.name} does not have OPD clinic hours on ${dayShort}.`,
                slots: []
            });
        }

        // 3. Generate slots based on slotDuration
        const durationMins = Number(doctor.slotDuration || 15);
        const [startH, startM] = dayConfig.startTime.split(':').map(Number);
        const [endH, endM] = dayConfig.endTime.split(':').map(Number);

        const startTotalMins = startH * 60 + startM;
        const endTotalMins = endH * 60 + endM;

        const isToday = moment().format('YYYY-MM-DD') === date;
        const currentMins = moment().hours() * 60 + moment().minutes();

        // 4. Fetch already booked appointments for this doctor on this day
        const startOfDay = queryMoment.clone().startOf('day').toDate();
        const endOfDay = queryMoment.clone().endOf('day').toDate();

        const bookedAppointments = await Appointment.find({
            doctorId,
            bookingType: 'OPD',
            appointmentDate: { $gte: startOfDay, $lte: endOfDay },
            status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital', 'No-Show'] }
        }).select('appointmentTime tokenNumber').lean();

        const bookedTimeSet = new Set(bookedAppointments.map(a => a.appointmentTime));

        const slots = [];
        for (let m = startTotalMins; m + durationMins <= endTotalMins; m += durationMins) {
            const h = Math.floor(m / 60);
            const min = m % 60;
            const timeString24 = `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
            const timeMoment = moment(`${date} ${timeString24}`, 'YYYY-MM-DD HH:mm');
            const displayTime = timeMoment.format('hh:mm A');

            const isPast = isToday && m <= currentMins;
            const isBooked = bookedTimeSet.has(timeString24) || bookedTimeSet.has(displayTime);

            slots.push({
                time: timeString24,
                displayTime,
                isAvailable: !isPast && !isBooked,
                status: isPast ? 'Past' : (isBooked ? 'Booked' : 'Available')
            });
        }

        return res.status(200).json({
            success: true,
            isDoctorOnLeave: false,
            date,
            day: dayShort,
            roomNumber: doctor.department?.roomNumber || "Cabin 1",
            opdFee: doctor.fees?.clinic || 500,
            totalSlots: slots.length,
            availableSlotsCount: slots.filter(s => s.isAvailable).length,
            slots
        });

    } catch (error) {
        console.error("Get Hospital Doctor OPD Slots Error:", error);
        return res.status(500).json({ success: false, message: error.message });
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

// @desc    Book Hospital OPD Consultation Appointment (Validates Leaves & Token Queue)
// @route   POST /user/hospital/opd/book
// @access  Private (User)
const bookHospitalOpdAppointment = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            hospitalId,
            doctorId,
            appointmentDate,
            appointmentTime,
            patients,
            paymentMethod = 'COD',
            bookingReason
        } = req.body;

        if (!hospitalId || !doctorId || !appointmentDate || !appointmentTime) {
            return res.status(400).json({
                success: false,
                message: "hospitalId, doctorId, appointmentDate, and appointmentTime are required."
            });
        }

        const dateMoment = moment(appointmentDate).startOf('day');
        if (!dateMoment.isValid()) {
            return res.status(400).json({ success: false, message: "Invalid appointmentDate format." });
        }

        // 1. Verify Doctor & Hospital
        const doctor = await Doctor.findOne({ _id: doctorId, hospitalId });
        if (!doctor || !doctor.isActive) {
            return res.status(404).json({ success: false, message: "Doctor not found in this hospital." });
        }

        // 🚨 2. BLOCK BOOKING IF DOCTOR IS ON APPROVED LEAVE
        const targetDay = dateMoment.toDate();
        const isDoctorOnLeave = Array.isArray(doctor.leaves) && doctor.leaves.some(l => 
            l.status === 'Approved' &&
            moment(targetDay).isBetween(moment(l.startDate).startOf('day'), moment(l.endDate).endOf('day'), null, '[]')
        );

        if (isDoctorOnLeave) {
            return res.status(400).json({
                success: false,
                message: `Booking failed: Dr. ${doctor.name} is on approved leave on ${moment(appointmentDate).format('YYYY-MM-DD')}.`
            });
        }

        // 3. Prevent duplicate booking for the exact same slot
        const startOfDay = dateMoment.clone().startOf('day').toDate();
        const endOfDay = dateMoment.clone().endOf('day').toDate();

        const slotConflict = await Appointment.findOne({
            doctorId,
            bookingType: 'OPD',
            appointmentDate: { $gte: startOfDay, $lte: endOfDay },
            appointmentTime: String(appointmentTime).trim(),
            status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital', 'No-Show'] }
        });

        if (slotConflict) {
            return res.status(400).json({
                success: false,
                message: "This OPD time slot has already been booked. Please choose another slot."
            });
        }

        // 4. Generate daily sequential token number
        const todayTokensCount = await Appointment.countDocuments({
            hospitalId,
            doctorId,
            bookingType: 'OPD',
            appointmentDate: { $gte: startOfDay, $lte: endOfDay },
            tokenNumber: { $ne: null }
        });

        const nextTokenNumber = todayTokensCount + 1;
        const opdFee = Number(doctor.fees?.clinic || 500);

        const timePart = Date.now().toString(36).toUpperCase();
        const randPart = crypto.randomBytes(2).toString('hex').toUpperCase();
        const generatedBookingId = `HKH-OPD-${timePart}-${randPart}`;

        const cleanPaymentMethod = String(paymentMethod).toUpperCase() === 'ONLINE' ? 'Online' : 'COD';

        const appointment = await Appointment.create({
            userId,
            hospitalId,
            doctorId,
            bookingType: 'OPD',
            bookingId: generatedBookingId,
            tokenNumber: nextTokenNumber,
            opdRoomNumber: doctor.department?.roomNumber || "Cabin 1",
            appointmentDate: dateMoment.toDate(),
            appointmentTime: String(appointmentTime).trim(),
            triageLevel: 'Routine',
            bookingReason: bookingReason || "Hospital OPD Consultation",
            status: 'Hospital-Pending',
            patients: Array.isArray(patients) && patients.length > 0 ? patients : [{
                patientName: req.user.name || "Patient",
                patientAge: Number(req.user.age || 30),
                gender: req.user.gender || "Male",
                relation: "Self"
            }],
            pricingBreakdown: {
                baseFee: opdFee,
                originalBaseFee: opdFee,
                subtotal: opdFee
            },
            totalAmount: opdFee,
            paymentMethod: cleanPaymentMethod,
            paymentStatus: 'Pending'
        });

        // 5. Alert Doctor & Hospital
        try {
            await sendPushNotification(
                doctorId,
                'doctor',
                `New OPD Token Booked (Token #${nextTokenNumber})`,
                `Patient ${appointment.patients[0]?.patientName} booked slot for ${appointmentTime}. Room: ${appointment.opdRoomNumber}.`,
                { appointmentId: appointment._id.toString(), tokenNumber: String(nextTokenNumber), type: 'new_opd_booking' }
            );
        } catch (e) {}

        return res.status(201).json({
            success: true,
            message: `OPD Appointment Booked! Token #${nextTokenNumber} assigned at ${appointment.opdRoomNumber}.`,
            bookingId: generatedBookingId,
            tokenNumber: nextTokenNumber,
            roomNumber: appointment.opdRoomNumber,
            appointmentId: appointment._id,
            totalAmount: opdFee,
            data: appointment
        });

    } catch (error) {
        console.error("Book Hospital OPD Error:", error);
        return res.status(500).json({ success: false, message: error.message });
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