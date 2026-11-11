const Hospital = require('../../../models/Hospital');
const Ward = require('../../../models/Ward');
const Bed = require('../../../models/Bed');
const Appointment = require('../../../models/Appointment');
const HospitalService = require('../../../models/HospitalService');
const Coupon = require('../../../models/Coupon');
const Doctor = require('../../../models/Doctor');
const User = require('../../../models/User');
const Insurance = require('../../../models/Insurance');
const Ambulance = require('../../../models/Ambulance');
const BedRescheduleLimit = require('../../../models/BedRescheduleLimit');
const UserSubscription = require('../../../models/UserSubscription');
const Availability = require('../../../models/Availability');
const Prescription = require('../../../models/Prescription');
const AmbulanceBooking = require('../../../models/AmbulanceBooking');

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

// Helper: Format human-readable duration between two timestamps
const formatUserShiftDuration = (startTime, endTime = new Date()) => {
    if (!startTime) return "0 mins";
    const diffMs = Math.max(0, new Date(endTime).getTime() - new Date(startTime).getTime());
    const totalMinutes = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const mins = totalMinutes % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours} hr${hours > 1 ? 's' : ''}`);
    parts.push(`${mins} min${mins !== 1 ? 's' : ''}`);
    return parts.join(' ');
};

// Helper: Enrich treatmentHistory array with full unaccepted/accepted/reassigned audit details
const enrichDoctorAssignmentHistory = (historyArray = [], appointmentStatus = 'Pending') => {
    const now = new Date();
    return (historyArray || []).map((item, index) => {
        const assignedTime = item.assignedAt || item.startTime || item.timestamp;
        const acceptedTime = item.acceptedAt || null;
        const endedTime = item.endTime || null;
        const status = item.acceptanceStatus || 'Pending-Acceptance';

        const isLastEntry = index === historyArray.length - 1;
        const isCaseClosed = ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital', 'No-Show'].includes(appointmentStatus);

        let computedUnacceptedWait = item.unacceptedWaitDuration || "";
        let computedActiveDuty = "";
        let liveStatusLabel = item.durationDisplay || "";

        if (status === 'Pending-Acceptance') {
            if (!endedTime && !isCaseClosed && isLastEntry) {
                computedUnacceptedWait = formatUserShiftDuration(assignedTime, now);
                liveStatusLabel = `Unaccepted for ${computedUnacceptedWait} (Awaiting Doctor Acceptance)`;
            } else {
                const refEnd = endedTime || now;
                computedUnacceptedWait = item.unacceptedWaitDuration || formatUserShiftDuration(assignedTime, refEnd);
                liveStatusLabel = `Not Accepted for ${computedUnacceptedWait}`;
            }
        } else if (status === 'Unaccepted-Reassigned') {
            const refEnd = endedTime || now;
            computedUnacceptedWait = item.unacceptedWaitDuration || formatUserShiftDuration(assignedTime, refEnd);
            liveStatusLabel = item.durationDisplay || `Did Not Accept for ${computedUnacceptedWait} (Reassigned)`;
        } else if (status === 'Rejected-By-Doctor') {
            const refEnd = endedTime || now;
            computedUnacceptedWait = item.unacceptedWaitDuration || formatUserShiftDuration(assignedTime, refEnd);
            liveStatusLabel = item.durationDisplay || `Rejected after ${computedUnacceptedWait}`;
        } else if (status === 'Accepted' || status === 'Replaced-After-Acceptance' || status === 'Completed') {
            const dutyStart = acceptedTime || assignedTime;
            if (!endedTime && !isCaseClosed && isLastEntry) {
                computedActiveDuty = formatUserShiftDuration(dutyStart, now);
                liveStatusLabel = `${computedActiveDuty} (Active Duty)`;
            } else {
                const dutyEnd = endedTime || now;
                computedActiveDuty = formatUserShiftDuration(dutyStart, dutyEnd);
                liveStatusLabel = item.durationDisplay || `${computedActiveDuty} (Shift Completed)`;
            }
        }

        return {
            ...item,
            fromDoctorName: item.fromDoctorId?.name || null,
            fromDoctorSpeciality: item.fromDoctorId?.speciality || null,
            toDoctorName: item.toDoctorId?.name || "Assigned Doctor",
            toDoctorSpeciality: item.toDoctorId?.speciality || "",
            assignmentSource: item.assignmentSource || 'Hospital-Admin',
            acceptanceStatus: status,
            assignedAt: assignedTime,
            acceptedAt: acceptedTime,
            endedAt: endedTime,
            unacceptedWaitDuration: computedUnacceptedWait,
            activeDutyDuration: computedActiveDuty,
            isCurrentlyActive: Boolean(!endedTime && !isCaseClosed && isLastEntry && status === 'Accepted'),
            isAwaitingAcceptance: Boolean(!endedTime && !isCaseClosed && isLastEntry && status === 'Pending-Acceptance'),
            durationDisplay: liveStatusLabel
        };
    });
};

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
// @desc    Calculate IPD Admission Checkout Bill Summary with Hospital Insurance Acceptance Validation
// @route   POST /user/hospital/checkout-summary
// @access  Private (User)
const getHospitalCheckoutSummary = async (req, res) => {
    try {
        let { hospitalId, bedId, doctorId, startDate, endDate, specialServices, couponCode } = req.body;
        const userId = req.user.id;

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

        const [hospital, targetBed, user] = await Promise.all([
            Hospital.findById(hospitalId).select('name isInsuranceAccepted acceptedInsurances').lean(),
            Bed.findOne({ _id: bedId, hospitalId }).populate('wardId').lean(),
            User.findById(userId).select('insuranceDetails').lean()
        ]);

        if (!hospital) {
            return res.status(404).json({ success: false, message: "Hospital not found." });
        }

        if (!targetBed) {
            return res.status(404).json({ success: false, message: "Selected bed not found in this hospital." });
        }

        const bedRate = Number(targetBed.pricePerDay || 1000);
        const baseStayFee = bedRate * stayDays;

        // 1. Resolve Optional Doctor Fee
        let doctorFee = 0;
        let selectedDoctorInfo = null;
        const rawDocId = doctorId || req.body.doctor?._id || req.body.doctor;
        if (rawDocId && rawDocId !== 'null' && rawDocId !== 'undefined' && String(rawDocId).trim() !== '') {
            const cleanDocId = String(rawDocId).trim();
            if (mongoose.isValidObjectId(cleanDocId)) {
                const doc = await Doctor.findOne({ _id: cleanDocId, hospitalId, isActive: true }).select('name speciality fees department').lean();
                if (doc) {
                    doctorFee = Number(doc.fees?.clinic || 0);
                    selectedDoctorInfo = { _id: doc._id, name: doc.name, speciality: doc.speciality, fee: doctorFee };
                }
            }
        }

        // 2. Resolve Special Services
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
                        resolvedServicesList.push({ serviceName: String(item.serviceName).trim(), price: Number(item.price || 0) });
                        specialServicesTotal += Number(item.price || 0);
                    }
                }
            }

            if (serviceIdsToQuery.length > 0) {
                const dbServices = await HospitalService.find({ _id: { $in: serviceIdsToQuery } }).lean();
                dbServices.forEach(srv => {
                    resolvedServicesList.push({ serviceId: srv._id, serviceName: srv.serviceName, price: Number(srv.price || 0) });
                    specialServicesTotal += Number(srv.price || 0);
                });
            }
        }

        // 3. Coupon Calculation
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
                appliedCoupon = { couponId: coupon._id, couponCode: coupon.couponName, discountAmount: couponDiscount };
            }
        }

        const subtotal = baseStayFee + specialServicesTotal + doctorFee;
        const totalPayable = Math.max(0, subtotal - couponDiscount);

        // 🚨 4. INSURANCE ACCEPTANCE VALIDATION
        const userInsurance = user?.insuranceDetails || {};
        const hospitalAcceptsCashless = hospital.isInsuranceAccepted !== false;
        const patientInsuranceCompany = userInsurance.companyName || "";

        let isAcceptedByHospital = false;
        if (hospitalAcceptsCashless && userInsurance.hasInsurance) {
            if (!hospital.acceptedInsurances || hospital.acceptedInsurances.length === 0) {
                isAcceptedByHospital = true; // Accepts all major insurances
            } else {
                isAcceptedByHospital = hospital.acceptedInsurances.some(ins => 
                    ins.toLowerCase().includes(patientInsuranceCompany.toLowerCase()) || 
                    patientInsuranceCompany.toLowerCase().includes(ins.toLowerCase())
                );
            }
        }

        return res.status(200).json({
            success: true,
            data: {
                wardName: targetBed.wardId?.name || "Ward",
                bedNumber: targetBed.bedNumber,
                pricePerDay: bedRate,
                days: stayDays,
                baseFee: baseStayFee,
                doctorVisitFee: doctorFee,
                selectedDoctor: selectedDoctorInfo,
                specialServicesCharges: specialServicesTotal,
                specialServices: resolvedServicesList,
                subtotal,
                discount: couponDiscount,
                appliedCoupon,
                totalPayable,
                // Insurance Policy Guidance Flags for UI
                insuranceGuidance: {
                    patientHasInsurance: Boolean(userInsurance.hasInsurance),
                    patientInsuranceCompany: patientInsuranceCompany || "None",
                    hospitalAcceptsCashless,
                    isAcceptedByThisHospital: isAcceptedByHospital,
                    hospitalAcceptedInsurances: hospital.acceptedInsurances || [],
                    policyMessage: isAcceptedByHospital 
                        ? "Cashless TPA claim is available at this hospital."
                        : (hospitalAcceptsCashless 
                            ? `Hospital accepts cashless claims for [${(hospital.acceptedInsurances || []).join(', ')}]. You can pay deposit and claim reimbursement later.`
                            : "This hospital operates on reimbursement mode only.")
                }
            }
        });

    } catch (error) {
        console.error("Get Hospital Checkout Summary Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};


// @desc    Final Hospital Bed Admission Booking (Records User-Selected Doctor in treatmentHistory at Booking Time)
// @route   POST /user/hospital/book
// @access  Private (User)
const finalHospitalBooking = async (req, res) => {
    try {
        const userId = req.user.id;
        let {
            hospitalId,
            bedId,
            doctorId,
            startDate,
            endDate,
            appointmentDate,
            bookingType = 'Admission',
            triageLevel = 'Routine',
            bookingReason,
            patients,
            specialServices,
            pricing,
            couponCode,
            paymentMethod = 'Online',
            insuranceDetails,
            hasInsurance,
            insuranceNumber,
            companyName,
            insuranceType,
            masterInsuranceId
        } = req.body;

        if (!hospitalId || !bedId || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: "hospitalId, bedId, startDate, and endDate are required."
            });
        }

        const [hospital, bed] = await Promise.all([
            Hospital.findById(hospitalId).lean(),
            Bed.findById(bedId).populate('wardId').lean()
        ]);

        if (!hospital) return res.status(404).json({ success: false, message: "Hospital not found." });
        if (!bed) return res.status(404).json({ success: false, message: "Selected bed not found." });

        // Parse patients safely
        if (typeof patients === 'string') {
            try { patients = JSON.parse(patients); } catch (e) { patients = []; }
        }
        const formattedPatients = Array.isArray(patients) && patients.length > 0
            ? patients.map((p, idx) => ({
                patientName: String(p.patientName || p.name || req.user.name || "Patient").trim(),
                patientAge: Number(p.patientAge || p.age || 30),
                gender: ['Male', 'Female', 'Other'].includes(p.gender) ? p.gender : 'Male',
                relation: p.relation || (idx === 0 ? 'Self' : 'Family'),
                reasonForVisit: p.reasonForVisit || bookingReason || "IPD Bed Admission",
                bloodGroup: p.bloodGroup || req.user.bloodGroup || null,
                isMainUser: Boolean(p.isMainUser ?? (idx === 0))
            }))
            : [{
                patientName: req.user.name || "Patient",
                patientAge: 30,
                gender: 'Male',
                relation: 'Self',
                reasonForVisit: bookingReason || "IPD Bed Admission",
                isMainUser: true
            }];

        // Parse specialServices safely
        if (typeof specialServices === 'string') {
            try { specialServices = JSON.parse(specialServices); } catch (e) { specialServices = []; }
        }
        let resolvedSpecialServices = [];
        let specialServicesSum = 0;
        if (Array.isArray(specialServices)) {
            for (const srv of specialServices) {
                const sId = typeof srv === 'object' ? (srv.serviceId || srv._id) : srv;
                if (sId && mongoose.isValidObjectId(sId)) {
                    const dbSrv = await HospitalService.findById(sId).lean();
                    if (dbSrv) {
                        resolvedSpecialServices.push({
                            serviceId: dbSrv._id,
                            serviceName: dbSrv.serviceName,
                            price: Number(dbSrv.price || 0)
                        });
                        specialServicesSum += Number(dbSrv.price || 0);
                    }
                }
            }
        }

        // Parse pricing object safely
        if (typeof pricing === 'string') {
            try { pricing = JSON.parse(pricing); } catch (e) { pricing = {}; }
        }

        const startMoment = moment(startDate).startOf('day');
        const endMoment = moment(endDate).endOf('day');
        const stayDays = Math.max(1, endMoment.diff(startMoment, 'days') || 1);

        const calculatedBaseStay = Number(bed.pricePerDay || 1000) * stayDays;
        const baseFee = Number(pricing?.baseFee ?? calculatedBaseStay);
        const visitCharges = Number(pricing?.visitCharges ?? 0);
        const extraCharges = Number(pricing?.extraCharges ?? specialServicesSum);
        const discountAmount = Number(pricing?.discountAmount ?? 0);
        const subtotal = Number(pricing?.subtotal ?? (baseFee + visitCharges + extraCharges));
        const finalPayable = Math.max(0, Number(pricing?.totalPayable ?? (subtotal - discountAmount)));

        const rawPayMethod = String(paymentMethod || 'Online').trim().toUpperCase();
        const isCod = rawPayMethod === 'COD' || rawPayMethod === 'CASH';
        const cleanPayMethod = isCod ? 'COD' : 'Online';

        if (isCod) {
            const codAllowed = await isCodEnabled('Hospital', userId);
            if (!codAllowed) {
                return res.status(400).json({
                    success: false,
                    message: "COD is disabled for Hospital Admissions. Please use Online Payment."
                });
            }
        }

        // Parse Insurance Details safely
        let parsedIns = {};
        if (typeof insuranceDetails === 'string') {
            try { parsedIns = JSON.parse(insuranceDetails); } catch (e) { parsedIns = {}; }
        } else if (insuranceDetails && typeof insuranceDetails === 'object') {
            parsedIns = insuranceDetails;
        }
        const isInsured = Boolean(hasInsurance === true || hasInsurance === 'true' || parsedIns.hasInsurance === true || parsedIns.hasInsurance === 'true');
        const rawMasterId = masterInsuranceId || parsedIns.masterInsuranceId || null;
        const validMasterInsId = (rawMasterId && mongoose.isValidObjectId(rawMasterId)) ? new mongoose.Types.ObjectId(rawMasterId) : null;

        const files = req.files || {};
        const docSingle = files.insuranceDocument?.[0] ? `/uploads/insurance/${files.insuranceDocument[0].filename}` : (parsedIns.insuranceDocument || null);
        const docFront = files.insuranceDocumentFront?.[0] ? `/uploads/insurance/${files.insuranceDocumentFront[0].filename}` : (parsedIns.insuranceDocumentFront || null);
        const docBack = files.insuranceDocumentBack?.[0] ? `/uploads/insurance/${files.insuranceDocumentBack[0].filename}` : (parsedIns.insuranceDocumentBack || null);

        // Verify pre-selected doctor if user selected a doctor during booking
        let preSelectedDoctor = null;
        if (doctorId && mongoose.isValidObjectId(doctorId)) {
            preSelectedDoctor = await Doctor.findOne({ _id: doctorId, hospitalId }).select('_id name speciality department').lean();
        }

        const now = new Date();
        const initialTreatmentHistory = [];

        // 🚨 AUDIT LOG: If user selected a doctor at booking time, record it immediately!
        if (preSelectedDoctor) {
            initialTreatmentHistory.push({
                fromDoctorId: null,
                toDoctorId: preSelectedDoctor._id,
                action: 'Booked-With-Doctor',
                assignmentSource: 'User-Selected-At-Booking',
                acceptanceStatus: 'Pending-Acceptance',
                assignedAt: now,
                acceptedAt: null,
                unacceptedWaitDuration: "",
                notes: `Patient selected Dr. ${preSelectedDoctor.name} (${preSelectedDoctor.speciality || 'Specialist'}) at the time of booking. Awaiting doctor acceptance.`,
                timestamp: now,
                startTime: now,
                endTime: null,
                durationDisplay: "Awaiting Doctor Acceptance"
            });
        }

        const uniqueBookingId = `HKH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const isInstantConfirm = (isCod || finalPayable === 0);

        let rzpOrder = null;
        if (!isInstantConfirm) {
            rzpOrder = await createRazorpayOrder(finalPayable, `hosp_${uniqueBookingId}`);
        }

        const newBooking = await Appointment.create({
            userId,
            hospitalId,
            bedId: bed._id,
            doctorId: preSelectedDoctor ? preSelectedDoctor._id : null,
            bookingType: 'Admission',
            bedBookingType: 'General-Bed',
            bookingId: uniqueBookingId,
            bookingReason: bookingReason || formattedPatients[0]?.reasonForVisit || "Hospital Bed Admission",
            triageLevel,
            wardName: bed.wardId?.name || "General Ward",
            bedNumber: bed.bedNumber,
            stayDuration: stayDays,
            startDate: startMoment.toDate(),
            endDate: endMoment.toDate(),
            appointmentDate: appointmentDate ? new Date(appointmentDate) : startMoment.toDate(),
            patients: formattedPatients,
            specialServices: resolvedSpecialServices,
            pricingBreakdown: {
                baseFee,
                originalBaseFee: baseFee,
                visitCharges,
                extraCharges,
                discountAmount,
                subtotal,
                bookedDurationDays: stayDays,
                depositPaidOnBooking: finalPayable
            },
            totalAmount: finalPayable,
            paymentMethod: cleanPayMethod,
            paymentStatus: finalPayable === 0 ? 'Paid' : 'Pending',
            status: isInstantConfirm ? 'Hospital-Pending' : 'Pending',
            transactionId: rzpOrder ? rzpOrder.id : `COD-${uniqueBookingId}`,
            insuranceDetails: {
                hasInsurance: isInsured,
                insuranceNumber: String(insuranceNumber || parsedIns.insuranceNumber || "").trim(),
                companyName: String(companyName || parsedIns.companyName || "").trim(),
                insuranceType: String(insuranceType || parsedIns.insuranceType || "").trim(),
                masterInsuranceId: validMasterInsId,
                insuranceDocument: docSingle,
                insuranceDocumentFront: docFront,
                insuranceDocumentBack: docBack,
                approvalStatus: isInsured ? 'Pending' : 'None'
            },
            treatmentHistory: initialTreatmentHistory
        });

        if (isInstantConfirm) {
            await Bed.findByIdAndUpdate(bed._id, { $set: { status: 'Reserved' } });
            await syncHospitalWardAndBedCapacity(hospitalId, bed.wardId?._id);

            if (preSelectedDoctor) {
                sendPushNotification(
                    preSelectedDoctor._id,
                    'doctor',
                    "🏥 New Patient Selected You for Admission",
                    `Patient ${formattedPatients[0].patientName} booked Bed ${bed.bedNumber} (#${uniqueBookingId}) and selected you. Please review and accept.`,
                    { appointmentId: String(newBooking._id), bookingId: uniqueBookingId, type: 'USER_SELECTED_DOCTOR' }
                ).catch(() => {});
            }
        }

        return res.status(201).json({
            success: true,
            paymentRequired: !isInstantConfirm,
            message: isInstantConfirm
                ? "Hospital Bed Admission request submitted successfully."
                : "Order generated. Complete online payment to confirm bed reservation.",
            bookingId: uniqueBookingId,
            appointmentId: newBooking._id,
            razorpayOrderId: rzpOrder ? rzpOrder.id : null,
            amount: rzpOrder ? rzpOrder.amount : finalPayable * 100,
            totalPayable: finalPayable,
            currency: "INR",
            key_id: process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID,
            data: newBooking
        });

    } catch (error) {
        console.error("Final Hospital Booking Error:", error);
        return res.status(500).json({ success: false, message: error.message });
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


// @desc    Get Booking Patient Profiles with Pre-Saved Insurance Details
// @route   GET /user/hospital/booking-profiles
// @access  Private (User)
const getBookingProfiles = async (req, res) => {
    try {
        const userId = req.user.id;

        const user = await User.findById(userId)
            .select('name phone gender dob age bloodGroup insuranceDetails familyMember')
            .populate('insuranceDetails.masterInsuranceId', 'provider insuranceName type')
            .populate('familyMember.insuranceId', 'provider insuranceName type')
            .lean();

        if (!user) {
            return res.status(404).json({ success: false, message: "User profile not found." });
        }

        const userInsurance = user.insuranceDetails || {};

        // 1. Primary User Profile with saved insurance
        const profiles = [
            {
                id: 'Self',
                name: user.name || "Self",
                relation: 'Self',
                gender: user.gender || "Male",
                dob: user.dob || null,
                phone: user.phone || "",
                bloodGroup: user.bloodGroup || null,
                isMainUser: true,
                insurance: {
                    hasInsurance: Boolean(userInsurance.hasInsurance),
                    insuranceNumber: userInsurance.insuranceNumber || "",
                    companyName: userInsurance.masterInsuranceId?.insuranceName || userInsurance.companyName || "",
                    insuranceType: userInsurance.insuranceType || "Cashless",
                    insuranceDocumentFront: userInsurance.insuranceDocumentFront || null,
                    insuranceDocumentBack: userInsurance.insuranceDocumentBack || null,
                    insuranceDocument: userInsurance.insuranceDocument || null,
                    masterInsuranceId: userInsurance.masterInsuranceId?._id || null
                }
            }
        ];

        // 2. Family Members
        if (Array.isArray(user.familyMember)) {
            user.familyMember.forEach(fm => {
                profiles.push({
                    id: String(fm._id),
                    name: fm.memberName || fm.name || "Family Member",
                    relation: fm.relation || "Dependent",
                    gender: fm.gender || "Male",
                    dob: fm.dob || null,
                    phone: fm.phone || user.phone || "",
                    bloodGroup: fm.bloodGroup || null,
                    isMainUser: false,
                    insurance: {
                        hasInsurance: Boolean(fm.hasInsurance || fm.insuranceNo),
                        insuranceNumber: fm.insuranceNo || "",
                        companyName: fm.insuranceId?.insuranceName || "",
                        insuranceType: fm.insuranceId?.type || "Cashless",
                        insuranceDocumentFront: null,
                        insuranceDocumentBack: null,
                        insuranceDocument: null,
                        masterInsuranceId: fm.insuranceId?._id || null
                    }
                });
            });
        }

        return res.status(200).json({
            success: true,
            count: profiles.length,
            data: profiles
        });

    } catch (error) {
        console.error("Get Booking Profiles Error:", error);
        return res.status(500).json({ success: false, message: error.message });
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

// @desc    Get Hospital Doctor OPD Slots (Synced with Next.js & Flutter: totalFee, premiumFee, closureReason & Booked collisions)
// @route   GET /user/hospital/doctors/:doctorId/opd-slots
// @access  Public
const getHospitalDoctorOpdSlots = async (req, res) => {
    try {
        const { doctorId } = req.params;
        const { date, hospitalId } = req.query;

        if (!doctorId || !mongoose.isValidObjectId(doctorId)) {
            return res.status(400).json({ success: false, message: "Valid doctorId parameter is required." });
        }

        const targetDateStr = date ? String(date).trim() : moment().format('YYYY-MM-DD');
        const targetMoment = moment(targetDateStr, 'YYYY-MM-DD');

        if (!targetMoment.isValid()) {
            return res.status(400).json({ success: false, message: "Invalid date format. Expected YYYY-MM-DD." });
        }

        const targetDayShort = targetMoment.format('ddd'); // 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'
        const targetDayFull = targetMoment.format('dddd');  // 'Monday', 'Tuesday', etc.

        // 1. Fetch Doctor with Hospital details
        const doctor = await Doctor.findById(doctorId)
            .populate('hospitalId', 'name city address hospitalImage')
            .lean();

        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor profile not found." });
        }

        // 2. Resolve Active Hospital
        const targetHospitalId = hospitalId || doctor.hospitalId?._id || doctor.hospitalId;
        let hospitalData = doctor.hospitalId;

        if (hospitalId && (!hospitalData || String(hospitalData._id) !== String(hospitalId))) {
            hospitalData = await Hospital.findById(hospitalId).select('name city address hospitalImage').lean();
        }

        const opdRoomNumber = doctor.department?.roomNumber || "Cabin 1";
        const baseOpdFee = Number(doctor.fees?.clinic || 500);
        const resolvedSlotDuration = Math.max(5, parseInt(doctor.slotDuration) || 15);

        // 3. Check Doctor Leave for this specific date
        const isDoctorOnLeave = Array.isArray(doctor.leaves) && doctor.leaves.some(l => {
            if (l.status !== 'Approved') return false;
            const lStart = moment(l.startDate).startOf('day');
            const lEnd = moment(l.endDate).endOf('day');
            return targetMoment.isBetween(lStart, lEnd, null, '[]');
        });

        if (isDoctorOnLeave) {
            const leaveDoc = doctor.leaves.find(l => {
                const lStart = moment(l.startDate).startOf('day');
                const lEnd = moment(l.endDate).endOf('day');
                return targetMoment.isBetween(lStart, lEnd, null, '[]');
            });

            const reasonText = leaveDoc?.reason || "Doctor is on approved leave";

            return res.status(200).json({
                success: true,
                isClosed: true,
                isDoctorOnLeave: true,
                leaveReason: reasonText,
                closureReason: `${doctor.name} is on approved leave on ${targetDateStr}. (${reasonText})`, // Read by Next.js component
                message: `${doctor.name} is on approved leave on ${targetDateStr}.`,
                date: targetDateStr,
                day: targetDayShort,
                roomNumber: opdRoomNumber,
                opdFee: baseOpdFee,
                baseFee: baseOpdFee,
                slots: []
            });
        }

        // 4. Fetch Availability Config
        const availabilityConfig = await Availability.findOne({ 
            vendorId: doctorId, 
            vendorType: 'Doctor' 
        }).lean();

        const offDays = availabilityConfig?.offDays || [];
        const isOffDay = offDays.some(d => d.toLowerCase() === targetDayFull.toLowerCase() || d.toLowerCase() === targetDayShort.toLowerCase());

        const daySchedule = Array.isArray(doctor.availability) 
            ? doctor.availability.find(a => a.day && a.day.toLowerCase() === targetDayShort.toLowerCase())
            : null;

        if (isOffDay || (!daySchedule && !availabilityConfig?.startTime)) {
            const closedText = `${doctor.name} does not have OPD clinic hours on ${targetDayShort}.`;
            return res.status(200).json({
                success: true,
                isClosed: true,
                isDoctorOnLeave: false,
                closureReason: closedText, // Read by Next.js component
                message: closedText,
                date: targetDateStr,
                day: targetDayShort,
                roomNumber: opdRoomNumber,
                opdFee: baseOpdFee,
                baseFee: baseOpdFee,
                slots: []
            });
        }

        // 5. Determine Shift Timings
        const startTimeStr = daySchedule?.startTime || availabilityConfig?.startTime || "09:00";
        const endTimeStr = daySchedule?.endTime || availabilityConfig?.endTime || "18:00";

        const [startH, startM] = startTimeStr.split(':').map(Number);
        const [endH, endM] = endTimeStr.split(':').map(Number);

        const startTotalMinutes = startH * 60 + startM;
        const endTotalMinutes = endH * 60 + endM;

        if (startTotalMinutes >= endTotalMinutes) {
            return res.status(200).json({
                success: true,
                isClosed: true,
                isDoctorOnLeave: false,
                closureReason: "Invalid working hours configured.",
                message: "Invalid working hours configured.",
                date: targetDateStr,
                day: targetDayShort,
                slots: []
            });
        }

        // 6. Fetch Existing Booked Appointments for Collision Check
        const startOfDay = targetMoment.clone().startOf('day').toDate();
        const endOfDay = targetMoment.clone().endOf('day').toDate();

        const bookedAppointments = await Appointment.find({
            doctorId: doctor._id,
            appointmentDate: { $gte: startOfDay, $lte: endOfDay },
            status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital', 'No-Show'] }
        }).select('appointmentTime tokenNumber bookingId status').lean();

        // 7. Generate Slots with Exact Keys Required by Frontend Component
        const slots = [];
        const now = moment();
        const isToday = now.format('YYYY-MM-DD') === targetDateStr;

        const manualUnavailable = availabilityConfig?.unavailableSlots || [];
        const blockedSlotsWithReason = availabilityConfig?.blockedSlotsWithReason || [];
        const premiumSlotsList = availabilityConfig?.premiumSlots || [];

        let bookedCount = 0;
        let blockedCount = 0;
        let availableCount = 0;

        for (let minutes = startTotalMinutes; minutes + resolvedSlotDuration <= endTotalMinutes; minutes += resolvedSlotDuration) {
            const h = Math.floor(minutes / 60);
            const m = minutes % 60;
            const time24 = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
            
            const slotStartMoment = moment(`${targetDateStr} ${time24}`, 'YYYY-MM-DD HH:mm');
            const slotEndMoment = slotStartMoment.clone().add(resolvedSlotDuration, 'minutes');
            const displayTime = slotStartMoment.format('hh:mm A');
            const endDisplayTime = slotEndMoment.format('hh:mm A');

            // Category assignment matching Next.js useMemo groupedSlots
            let category = "Morning";
            if (h >= 12 && h < 17) category = "Afternoon";
            else if (h >= 17) category = "Evening";

            // Collision check against confirmed bookings
            const matchingBooking = bookedAppointments.find(appt => {
                if (!appt.appointmentTime) return false;
                const cleanApptTime = String(appt.appointmentTime).trim();
                return cleanApptTime === time24 || 
                       cleanApptTime === displayTime || 
                       cleanApptTime.startsWith(time24) ||
                       cleanApptTime.startsWith(displayTime);
            });

            // Blocked slot check
            const isManuallyBlocked = manualUnavailable.includes(time24);
            const specificDateBlock = blockedSlotsWithReason.find(b => 
                b.date === targetDateStr && (b.time === time24 || b.time === displayTime)
            );

            // Past time check
            const isPastTime = isToday && slotStartMoment.isBefore(now);

            // Premium surcharge calculation
            const premiumMatch = premiumSlotsList.find(p => p.time === time24 || p.time === displayTime);
            const extraFee = premiumMatch ? Number(premiumMatch.extraFee || 0) : 0;
            const calculatedTotalFee = baseOpdFee + extraFee;

            let status = "Available";
            let isAvailable = true;
            let isBooked = false;

            if (matchingBooking) {
                status = "Booked";
                isAvailable = false;
                isBooked = true;
                bookedCount++;
            } else if (specificDateBlock || isManuallyBlocked) {
                status = "Blocked";
                isAvailable = false;
                blockedCount++;
            } else if (isPastTime) {
                status = "Past";
                isAvailable = false;
            } else {
                availableCount++;
            }

            slots.push({
                time: time24,
                displayTime: displayTime,
                endTime: slotEndMoment.format('HH:mm'),
                endTimeDisplay: endDisplayTime,
                category: category,                  // Read by frontend: 'Morning' | 'Afternoon' | 'Evening'

                // 🚨 KEYS EXACTLY MATCHED WITH NEXT.JS COMPONENT (AppointmentScheduler.jsx)
                totalFee: calculatedTotalFee,        // Primary key used by frontend line 192 & 233
                totalSlotFee: calculatedTotalFee,    // Fallback key
                price: calculatedTotalFee,           // Standard key
                baseFee: baseOpdFee,
                premiumFee: extraFee,                // Read by frontend line 203: +₹{slot.premiumFee}
                extraFee: extraFee,
                isPremium: extraFee > 0,             // Read by frontend line 150 & 166

                isBooked: isBooked,
                isAvailable: isAvailable,            // Read by frontend line 149
                status: status,                      // 'Available' | 'Booked' | 'Blocked' | 'Past'
                blockReason: specificDateBlock?.reason || (isManuallyBlocked ? "Doctor Blocked Slot" : null)
            });
        }

        return res.status(200).json({
            success: true,
            isClosed: false,
            isDoctorOnLeave: false,
            date: targetDateStr,
            day: targetDayShort,
            doctor: {
                _id: doctor._id,
                name: doctor.name,
                speciality: doctor.speciality,
                qualification: doctor.qualification,
                profileImage: doctor.profileImage || null,
                department: {
                    roomNumber: opdRoomNumber,
                    isNormal: doctor.department?.isNormal ?? true,
                    isEmergency: doctor.department?.isEmergency ?? false
                }
            },
            hospital: hospitalData ? {
                _id: hospitalData._id,
                name: hospitalData.name,
                city: hospitalData.city,
                address: hospitalData.address,
                hospitalImage: hospitalData.hospitalImage?.[0] || null
            } : null,
            roomNumber: opdRoomNumber,
            opdFee: baseOpdFee,
            baseFee: baseOpdFee,
            slotDuration: resolvedSlotDuration,
            totalSlots: slots.length,
            availableSlotsCount: availableCount,
            bookedSlotsCount: bookedCount,
            blockedSlotsCount: blockedCount,
            categories: ["Morning", "Afternoon", "Evening"],
            slots: slots
        });

    } catch (error) {
        console.error("Get Hospital Doctor OPD Slots Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get Hospital OPD Checkout Summary (With Base Fee, Premium Surcharges, Special Services, Coupons & COD Status)
// @route   POST /user/hospital/opd/checkout-summary
// @access  Private (User)
const getHospitalOpdCheckoutSummary = async (req, res) => {
    try {
        const userId = req.user.id;
        const { 
            doctorId, 
            hospitalId, 
            appointmentDate, 
            appointmentTime, 
            timeSlot, // Fallback key
            couponCode, 
            specialServiceIds, 
            patientCount = 1 
        } = req.body;

        if (!doctorId || !mongoose.isValidObjectId(doctorId)) {
            return res.status(400).json({ success: false, message: "Valid doctorId is required." });
        }

        const selectedSlotTime = String(appointmentTime || timeSlot || "09:00").trim();
        const targetDateStr = appointmentDate ? String(appointmentDate).trim() : moment().format('YYYY-MM-DD');

        // 1. Fetch Doctor with Hospital population
        const doctor = await Doctor.findById(doctorId)
            .populate('hospitalId', 'name city address hospitalImage isInsuranceAccepted')
            .lean();

        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found." });
        }

        const resolvedHospitalId = hospitalId || doctor.hospitalId?._id || doctor.hospitalId;
        const hospitalData = doctor.hospitalId;

        const opdRoomNumber = doctor.department?.roomNumber || "Cabin 1";
        const baseOpdFee = Number(doctor.fees?.clinic || 500);

        // 2. Fetch Availability Config for Premium Surcharge on this exact slot
        const availabilityConfig = await Availability.findOne({
            vendorId: doctorId,
            vendorType: 'Doctor'
        }).lean();

        const premiumSlotsList = availabilityConfig?.premiumSlots || [];
        const cleanSlot24 = selectedSlotTime.split(' ')[0]; // e.g. "16:40"
        
        const premiumMatch = premiumSlotsList.find(p => 
            p.time === cleanSlot24 || 
            p.time === selectedSlotTime ||
            selectedSlotTime.startsWith(p.time)
        );

        const premiumFee = premiumMatch ? Number(premiumMatch.extraFee || 0) : 0;
        const slotTotalFee = baseOpdFee + premiumFee;
        const numPatients = Math.max(1, parseInt(patientCount) || 1);

        let consultationSubtotal = slotTotalFee * numPatients;

        // 3. Resolve Special Services if any selected
        let specialServicesTotal = 0;
        let selectedServicesList = [];
        if (Array.isArray(specialServiceIds) && specialServiceIds.length > 0) {
            const foundServices = await HospitalService.find({
                _id: { $in: specialServiceIds },
                hospitalId: resolvedHospitalId
            }).lean();

            selectedServicesList = foundServices.map(s => ({
                serviceId: s._id,
                serviceName: s.serviceName,
                price: Number(s.price || 0)
            }));
            specialServicesTotal = selectedServicesList.reduce((sum, s) => sum + s.price, 0);
        }

        const subtotal = consultationSubtotal + specialServicesTotal;

        // 4. Check VIP Subscription Benefit for Free Doctor Appointment
        let subscriptionBenefit = {
            isApplied: false,
            planName: "",
            discountAmount: 0
        };

        const subCheck = await checkAndApplyBenefit(userId, 'freeDoctorAppointmentsCount', baseOpdFee);
        if (subCheck.isApplied) {
            subscriptionBenefit = {
                isApplied: true,
                planName: subCheck.planName || "Active Care Plan",
                discountAmount: baseOpdFee
            };
        }

        // 5. Coupon Discount Evaluation
        let couponDiscount = 0;
        let appliedCouponDetails = null;

        if (couponCode && String(couponCode).trim() !== "") {
            const cleanCode = String(couponCode).trim().toUpperCase();
            const today = new Date();

            const coupon = await Coupon.findOne({
                couponName: cleanCode,
                isActive: true,
                expiryDate: { $gte: today }
            }).lean();

            if (coupon && subtotal >= (coupon.minOrderAmount || 0)) {
                // Verify coupon eligibility (Hospital / Doctor / All)
                const isEligible = coupon.vendorType === 'All' || 
                                   coupon.vendorType === 'Hospital' || 
                                   coupon.vendorType === 'Doctor' ||
                                   String(coupon.vendorId) === String(resolvedHospitalId);

                if (isEligible) {
                    couponDiscount = Math.min(
                        Math.round((subtotal * coupon.discountPercentage) / 100),
                        coupon.maxDiscount || Infinity
                    );
                    appliedCouponDetails = {
                        couponId: coupon._id,
                        couponCode: coupon.couponName,
                        discountPercentage: coupon.discountPercentage,
                        discountAmount: couponDiscount
                    };
                }
            }
        }

        // Calculate Final Amount
        const totalDeductions = couponDiscount + (subscriptionBenefit.isApplied ? subscriptionBenefit.discountAmount : 0);
        const finalPayable = Math.max(0, subtotal - totalDeductions);

        // 6. Universal COD Evaluation (VIP Subscribers always get COD unlocked)
        const isCodAvailable = await isCodEnabled('Hospital', userId);

        return res.status(200).json({
            success: true,
            data: {
                // Doctor & Hospital Profile Info
                doctor: {
                    _id: doctor._id,
                    name: doctor.name,
                    speciality: doctor.speciality,
                    qualification: doctor.qualification || "MBBS, MD",
                    department: doctor.department || { roomNumber: opdRoomNumber },
                    profileImage: doctor.profileImage || null
                },
                hospital: hospitalData ? {
                    _id: hospitalData._id,
                    name: hospitalData.name,
                    city: hospitalData.city,
                    address: hospitalData.address,
                    hospitalImage: hospitalData.hospitalImage?.[0] || null
                } : null,

                roomNumber: opdRoomNumber,
                opdRoomNumber: opdRoomNumber,
                appointmentDate: targetDateStr,
                appointmentTime: selectedSlotTime,

                // Slot Pricing Metrics
                slot: {
                    time: selectedSlotTime,
                    category: cleanSlot24 >= "17:00" ? "Evening" : (cleanSlot24 >= "12:00" ? "Afternoon" : "Morning"),
                    baseFee: baseOpdFee,
                    opdFee: baseOpdFee,
                    premiumFee: premiumFee,
                    extraFee: premiumFee,
                    totalFee: slotTotalFee,        // Key matched with frontend AppointmentScheduler
                    totalSlotFee: slotTotalFee,    // Fallback key
                    isPremium: premiumFee > 0
                },

                // Billing Ledger Breakdown
                pricingBreakdown: {
                    baseFee: baseOpdFee,
                    opdFee: baseOpdFee,
                    premiumFee: premiumFee,
                    slotTotalFee: slotTotalFee,
                    totalFee: slotTotalFee,
                    patientCount: numPatients,
                    specialServicesCharges: specialServicesTotal,
                    subtotal: subtotal,
                    couponDiscount: couponDiscount,
                    subscriptionDiscount: subscriptionBenefit.discountAmount,
                    totalAmount: finalPayable,
                    totalPayable: finalPayable
                },

                totalPayable: finalPayable,
                totalAmount: finalPayable,
                specialServices: selectedServicesList,
                appliedCoupon: appliedCouponDetails,
                subscriptionBenefit: subscriptionBenefit,

                // Payment Options Flag
                isCodAvailable: isCodAvailable
            }
        });

    } catch (error) {
        console.error("Get Hospital OPD Checkout Summary Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Book Hospital OPD Appointment (Crash-Proof JSON/FormData Parser, Token Generator & Razorpay Safe)
// @route   POST /user/hospital/opd/book
// @access  Private (User)
const bookHospitalOpdAppointment = async (req, res) => {
    try {
        const userId = req.user.id;
        const body = req.body || {};

        let {
            hospitalId,
            doctorId,
            appointmentDate,
            date,
            appointmentTime,
            timeSlot,
            time,
            patients,
            specialServices,
            couponCode,
            paymentMethod,
            bookingReason,
            reasonForVisit,
            insuranceDetails,
            hasInsurance,
            insuranceNumber,
            companyName,
            insuranceType,
            masterInsuranceId
        } = body;

        // 1. Resolve flexible date and time keys from frontend
        const targetDateStr = String(appointmentDate || date || moment().format('YYYY-MM-DD')).trim();
        const targetTimeStr = String(appointmentTime || timeSlot || time || "10:00 AM").trim();

        if (!doctorId || !mongoose.isValidObjectId(doctorId)) {
            return res.status(400).json({
                success: false,
                message: "Valid doctorId is required for Hospital OPD booking."
            });
        }

        // 2. Fetch Doctor & Resolve Hospital ID automatically if frontend missed hospitalId
        const doctor = await Doctor.findById(doctorId).lean();
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Hospital Doctor not found." });
        }

        const resolvedHospitalId = (hospitalId && mongoose.isValidObjectId(hospitalId))
            ? hospitalId
            : doctor.hospitalId;

        if (!resolvedHospitalId) {
            return res.status(400).json({
                success: false,
                message: "This doctor is not linked to any hospital. Please use Independent Doctor booking."
            });
        }

        const hospital = await Hospital.findById(resolvedHospitalId).lean();
        if (!hospital) {
            return res.status(404).json({ success: false, message: "Hospital not found." });
        }

        // 3. Validate Date Format
        const parsedDate = moment(targetDateStr, ['YYYY-MM-DD', moment.ISO_8601]);
        if (!parsedDate.isValid()) {
            return res.status(400).json({
                success: false,
                message: "Invalid appointmentDate format. Expected YYYY-MM-DD."
            });
        }

        const startOfDay = parsedDate.clone().startOf('day').toDate();
        const endOfDay = parsedDate.clone().endOf('day').toDate();

        // 4. Crash-Proof Patients Array Parser (Handles JSON, Stringified JSON, or fallback to logged-in user)
        let parsedPatients = [];
        if (typeof patients === 'string') {
            try { parsedPatients = JSON.parse(patients); } catch (e) { parsedPatients = []; }
        } else if (Array.isArray(patients)) {
            parsedPatients = patients;
        } else if (patients && typeof patients === 'object') {
            parsedPatients = [patients];
        }

        const formattedPatients = parsedPatients.length > 0
            ? parsedPatients.map((p, idx) => {
                const rawGender = String(p.gender || req.user.gender || 'Male').trim();
                const validGender = ['Male', 'Female', 'Other'].includes(rawGender) ? rawGender : 'Male';
                const parsedAge = parseInt(p.patientAge || p.age || 30);

                return {
                    patientName: String(p.patientName || p.name || p.memberName || req.user.name || "Patient").trim(),
                    patientAge: isNaN(parsedAge) || parsedAge <= 0 ? 30 : parsedAge,
                    gender: validGender,
                    relation: String(p.relation || (idx === 0 ? 'Self' : 'Family')).trim(),
                    reasonForVisit: String(p.reasonForVisit || bookingReason || reasonForVisit || "OPD Consultation").trim(),
                    bloodGroup: p.bloodGroup || req.user.bloodGroup || null,
                    isMainUser: Boolean(p.isMainUser ?? (idx === 0))
                };
            })
            : [{
                patientName: req.user.name || "Patient",
                patientAge: req.user.dob ? Math.max(1, moment().diff(moment(req.user.dob), 'years')) : 30,
                gender: ['Male', 'Female', 'Other'].includes(req.user.gender) ? req.user.gender : 'Male',
                relation: 'Self',
                reasonForVisit: String(bookingReason || reasonForVisit || "OPD Consultation").trim(),
                bloodGroup: req.user.bloodGroup || null,
                isMainUser: true
            }];

        const patientCount = Math.max(1, formattedPatients.length);

        // 5. Crash-Proof Special Services Parser
        let parsedServicesInput = [];
        if (typeof specialServices === 'string') {
            try { parsedServicesInput = JSON.parse(specialServices); } catch (e) { parsedServicesInput = []; }
        } else if (Array.isArray(specialServices)) {
            parsedServicesInput = specialServices;
        }

        let specialServicesList = [];
        let specialServicesTotal = 0;

        for (const srv of parsedServicesInput) {
            const srvId = typeof srv === 'object' ? (srv.serviceId || srv._id || srv.id) : srv;
            if (srvId && mongoose.isValidObjectId(srvId)) {
                const dbService = await HospitalService.findById(srvId).lean();
                if (dbService) {
                    const price = Number(dbService.price || 0);
                    specialServicesList.push({
                        serviceId: dbService._id,
                        serviceName: dbService.serviceName,
                        price: price
                    });
                    specialServicesTotal += price;
                }
            }
        }

        // 6. Pricing Calculation (Base OPD Fee + Premium Slot Surcharge + Special Services - Coupon)
        const singleOpdFee = Number(doctor.fees?.clinic || 500);
        const originalBaseFee = singleOpdFee * patientCount;

        // Check Premium Slot Fee if configured in Availability
        let premiumSlotFee = 0;
        const availConfig = await Availability.findOne({ vendorId: doctor._id }).lean();
        if (availConfig && Array.isArray(availConfig.premiumSlots)) {
            const normTime24 = moment(targetTimeStr, ["HH:mm", "hh:mm A"]).format("HH:mm");
            const matchedPremium = availConfig.premiumSlots.find(ps =>
                moment(ps.time, ["HH:mm", "hh:mm A"]).format("HH:mm") === normTime24
            );
            if (matchedPremium) {
                premiumSlotFee = Number(matchedPremium.extraFee || 0);
            }
        }

        // Subscription Benefit Check (Free Doctor Consultation Quota)
        const subBenefit = await checkAndApplyBenefit(userId, 'freeDoctorAppointmentsCount', originalBaseFee);
        const effectiveBaseFee = subBenefit.isApplied ? 0 : originalBaseFee;

        const subtotalBeforeCoupon = effectiveBaseFee + premiumSlotFee + specialServicesTotal;

        // Coupon Evaluation
        let discountAmount = 0;
        let appliedCouponObj = undefined;
        if (couponCode && String(couponCode).trim() !== "") {
            const cleanCode = String(couponCode).trim().toUpperCase();
            const coupon = await Coupon.findOne({
                couponName: cleanCode,
                isActive: true,
                expiryDate: { $gte: new Date() },
                $or: [
                    { vendorId: resolvedHospitalId },
                    { isAdminCreated: true, vendorType: { $in: ['Hospital', 'Doctor', 'All'] } }
                ]
            }).lean();

            if (coupon && subtotalBeforeCoupon >= Number(coupon.minOrderAmount || 0)) {
                const calcDisc = Math.round((subtotalBeforeCoupon * Number(coupon.discountPercentage || 0)) / 100);
                discountAmount = Math.min(calcDisc, Number(coupon.maxDiscount || calcDisc));
                appliedCouponObj = {
                    couponId: coupon._id,
                    couponCode: coupon.couponName,
                    discountValue: discountAmount
                };
            }
        }

        const finalPayable = Math.max(0, Math.round(subtotalBeforeCoupon - discountAmount));

        // 7. Normalize Payment Method Safely (Matches Appointment Schema Enum)
        const rawMethod = String(paymentMethod || 'Online').trim().toUpperCase();
        const isCodOrCash = rawMethod === 'COD' || rawMethod === 'CASH' || rawMethod.includes('HOSPITAL') || rawMethod.includes('COUNTER') || rawMethod.includes('PAY AT');
        const normalizedPaymentMethod = isCodOrCash ? 'COD' : 'Online';

        if (normalizedPaymentMethod === 'COD') {
            const codAllowed = await isCodEnabled('Hospital', userId);
            if (!codAllowed) {
                return res.status(400).json({
                    success: false,
                    message: "Pay at Hospital (COD) is currently disabled. Please proceed with Online Payment."
                });
            }
        }

        // 8. Parse Insurance Details Safely (Prevent Empty String ObjectId CastError)
        let parsedIns = {};
        if (typeof insuranceDetails === 'string') {
            try { parsedIns = JSON.parse(insuranceDetails); } catch (e) { parsedIns = {}; }
        } else if (insuranceDetails && typeof insuranceDetails === 'object') {
            parsedIns = insuranceDetails;
        }

        const isInsuredBool = Boolean(
            hasInsurance === true || hasInsurance === 'true' ||
            parsedIns.hasInsurance === true || parsedIns.hasInsurance === 'true'
        );

        const rawMasterInsId = masterInsuranceId || parsedIns.masterInsuranceId || null;
        const validMasterInsId = (rawMasterInsId && mongoose.isValidObjectId(rawMasterInsId))
            ? new mongoose.Types.ObjectId(rawMasterInsId)
            : null;

        const files = req.files || {};
        const docSingle = files.insuranceDocument?.[0] ? `/uploads/insurance/${files.insuranceDocument[0].filename}` : (parsedIns.insuranceDocument || null);
        const docFront = files.insuranceDocumentFront?.[0] ? `/uploads/insurance/${files.insuranceDocumentFront[0].filename}` : (parsedIns.insuranceDocumentFront || null);
        const docBack = files.insuranceDocumentBack?.[0] ? `/uploads/insurance/${files.insuranceDocumentBack[0].filename}` : (parsedIns.insuranceDocumentBack || null);

        // 9. Generate Daily Sequential OPD Token Number for this Doctor on this Date
        const existingOpdCount = await Appointment.countDocuments({
            hospitalId: resolvedHospitalId,
            doctorId: doctor._id,
            bookingType: 'OPD',
            appointmentDate: { $gte: startOfDay, $lte: endOfDay }
        });
        const nextTokenNumber = existingOpdCount + 1;

        const uniqueBookingId = `HKO-${Date.now().toString(36).toUpperCase().slice(-4)}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
        const opdRoom = doctor.department?.roomNumber || "OPD Cabin 1";

        // 10. Create Razorpay Order ONLY if Online Payment AND finalPayable > 0
        let rzpOrder = null;
        const isInstantConfirm = (normalizedPaymentMethod === 'COD' || finalPayable === 0);

        if (!isInstantConfirm) {
            rzpOrder = await createRazorpayOrder(finalPayable, `opd_${uniqueBookingId}`);
        }

        // 11. Create Appointment Document
        const newOpdAppointment = await Appointment.create({
            userId,
            hospitalId: resolvedHospitalId,
            doctorId: doctor._id,
            bookingType: 'OPD',
            tokenNumber: nextTokenNumber,
            opdRoomNumber: opdRoom,
            bookingId: uniqueBookingId,
            bookingReason: String(bookingReason || reasonForVisit || formattedPatients[0]?.reasonForVisit || "OPD Consultation").trim(),
            patients: formattedPatients,
            appointmentDate: startOfDay,
            appointmentTime: targetTimeStr,
            consultationType: 'Clinic Visit',
            specialServices: specialServicesList,
            pricingBreakdown: {
                baseFee: effectiveBaseFee,
                originalBaseFee: originalBaseFee,
                visitCharges: 0,
                extraCharges: premiumSlotFee + specialServicesTotal,
                discountAmount: discountAmount,
                subtotal: subtotalBeforeCoupon
            },
            totalAmount: finalPayable,
            paymentMethod: normalizedPaymentMethod,
            paymentStatus: finalPayable === 0 ? 'Paid' : 'Pending',
            status: isInstantConfirm ? 'Confirmed' : 'Pending',
            transactionId: rzpOrder ? rzpOrder.id : (finalPayable === 0 ? `FREE-OPD-${Date.now()}` : `COD-OPD-${Date.now()}`),
            couponDetails: appliedCouponObj,
            insuranceDetails: {
                hasInsurance: isInsuredBool,
                insuranceNumber: String(insuranceNumber || parsedIns.insuranceNumber || "").trim(),
                companyName: String(companyName || parsedIns.companyName || "").trim(),
                insuranceType: String(insuranceType || parsedIns.insuranceType || "").trim(),
                masterInsuranceId: validMasterInsId,
                insuranceDocument: docSingle,
                insuranceDocumentFront: docFront,
                insuranceDocumentBack: docBack,
                approvalStatus: isInsuredBool ? 'Pending' : 'None'
            },
            treatmentHistory: [{
                fromDoctorId: null,
                toDoctorId: doctor._id,
                action: 'Initial-Assignment',
                notes: `OPD Token #${nextTokenNumber} booked for Dr. ${doctor.name} (${opdRoom}).`,
                subscriptionDetails: {
                    isSubscriptionApplied: subBenefit.isApplied,
                    userSubscriptionId: subBenefit.subId || null,
                    planName: subBenefit.planName || ""
                },
                timestamp: new Date(),
                startTime: new Date(),
                endTime: null,
                durationDisplay: "Scheduled OPD"
            }]
        });

        // 12. Deduct Subscription Benefit & Mark Coupon Used if Confirmed Immediately
        if (isInstantConfirm) {
            if (subBenefit.isApplied) {
                await deductBenefitCount(userId, 'freeDoctorAppointmentsCount');
            }
            if (appliedCouponObj?.couponId) {
                await Coupon.updateOne(
                    { _id: appliedCouponObj.couponId },
                    { $push: { usedBy: { userId, usageCount: 1 } } }
                );
            }

            // Dispatch Notifications in background
            Promise.allSettled([
                sendPushNotification(
                    doctor._id,
                    'doctor',
                    `🎟️ New OPD Booking (Token #${nextTokenNumber})`,
                    `Patient ${formattedPatients[0].patientName} booked OPD slot at ${targetTimeStr} on ${targetDateStr}.`,
                    { appointmentId: String(newOpdAppointment._id), bookingId: uniqueBookingId, type: 'NEW_OPD_BOOKING' }
                ),
                notifyAdminsAndVendor(
                    resolvedHospitalId,
                    'hospital',
                    `🎟️ New Hospital OPD Booking (#${uniqueBookingId})`,
                    `Token #${nextTokenNumber} booked for Dr. ${doctor.name} (${opdRoom}) on ${targetDateStr}.`,
                    { appointmentId: String(newOpdAppointment._id), bookingId: uniqueBookingId, type: 'NEW_OPD_BOOKING' }
                )
            ]);
        }

        return res.status(201).json({
            success: true,
            paymentRequired: !isInstantConfirm,
            message: isInstantConfirm
                ? `OPD Appointment Confirmed! Your Queue Token is #${nextTokenNumber} (${opdRoom}).`
                : "OPD Order generated. Please complete online payment to confirm your token.",
            bookingId: uniqueBookingId,
            appointmentId: newOpdAppointment._id,
            tokenNumber: nextTokenNumber,
            opdRoomNumber: opdRoom,
            razorpayOrderId: rzpOrder ? rzpOrder.id : null,
            amount: rzpOrder ? rzpOrder.amount : finalPayable * 100,
            totalPayable: finalPayable,
            currency: "INR",
            key_id: process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID,
            data: newOpdAppointment
        });

    } catch (error) {
        console.error("Book Hospital OPD Appointment Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
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


// @desc    Get Single Hospital Booking Full Details for User (With Enriched Doctor Assignment History)
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
            .populate('hospitalId', 'name address city state phone hospitalImage location isInsuranceAccepted')
            .populate('doctorId', 'name speciality qualification profileImage fees department phone')
            .populate('pendingDoctorId', 'name speciality qualification profileImage department phone')
            .populate({
                path: 'bedId',
                select: 'bedNumber status pricePerDay isVentilatorAvailable wardId',
                populate: { path: 'wardId', select: 'name type' }
            })
            .populate('ambulanceId', 'name phone vehicleNumber vehicleType location driverInfo')
            .populate('specialServices.serviceId', 'serviceName price image description')
            .populate('insuranceDetails.masterInsuranceId', 'provider insuranceName type')
            .populate('treatmentHistory.fromDoctorId', 'name speciality profileImage department phone')
            .populate('treatmentHistory.toDoctorId', 'name speciality profileImage department phone')
            .populate('clinicalLogs.doctorId', 'name speciality profileImage department phone')
            .populate('bedsideCareTeam.doctorId', 'name speciality profileImage department phone')
            .populate('activeMedications.addedBy', 'name speciality profileImage')
            .lean();

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Hospital booking record not found."
            });
        }

        const [prescriptions, linkedIpdAdmission, linkedAmbulance] = await Promise.all([
            Prescription.find({ appointmentId: booking._id })
                .populate('doctorId', 'name speciality qualification signatureImage')
                .sort({ createdAt: -1 })
                .lean(),
            booking.bookingType === 'OPD'
                ? Appointment.findOne({ opdAppointmentId: booking._id, userId })
                    .select('_id bookingId status paymentStatus wardName bedNumber totalAmount admissionHoldExpiresAt')
                    .lean()
                : Promise.resolve(null),
            booking.transactionId
                ? AmbulanceBooking.findOne({ bookingId: booking.transactionId })
                    .populate('ambulanceId', 'name phone vehicleNumber vehicleType location')
                    .lean()
                : Promise.resolve(null)
        ]);

        const enrichedTreatmentHistory = enrichDoctorAssignmentHistory(booking.treatmentHistory, booking.status);

        const enrichedClinicalLogs = (booking.clinicalLogs || []).map(log => ({
            ...log,
            doctorName: log.doctorId?.name || "Attending Doctor",
            doctorSpeciality: log.doctorId?.speciality || ""
        }));

        return res.status(200).json({
            success: true,
            data: {
                ...booking,
                isOpd: booking.bookingType === 'OPD',
                isIpd: booking.bookingType === 'Admission',
                treatmentHistory: enrichedTreatmentHistory,
                clinicalLogs: enrichedClinicalLogs,
                prescriptions: prescriptions || [],
                linkedIpdAdmission: linkedIpdAdmission || null,
                ambulanceJourney: linkedAmbulance || null
            }
        });

    } catch (error) {
        console.error("Get Hospital Booking Details Error:", error);
        return res.status(500).json({ success: false, message: error.message });
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