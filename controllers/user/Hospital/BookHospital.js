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


// @desc    List Hospitals (Searches by Hospital Name, City AND Medical Speciality / Diseases)
// @route   POST /user/hospital/list
// @access  Public / User
const getHospitals = async (req, res) => {
    try {
        const { search, city, userLat, userLng } = req.body;

        let query = { profileStatus: 'Approved', isActive: true };

        if (city && city.trim() !== '') {
            query.city = { $regex: city.trim(), $options: 'i' };
        }

        // Search in Hospital Name, City, or Doctor's Medical Speciality
        if (search && search.trim() !== '') {
            const cleanSearch = search.trim();
            
            // Check which hospitals have doctors with this medical speciality
            const matchedDoctorHospitalIds = await Doctor.find({
                speciality: { $regex: cleanSearch, $options: 'i' },
                hospitalId: { $ne: null },
                profileStatus: 'Approved',
                isActive: true
            }).distinct('hospitalId');

            query.$or = [
                { name: { $regex: cleanSearch, $options: 'i' } },
                { city: { $regex: cleanSearch, $options: 'i' } },
                { address: { $regex: cleanSearch, $options: 'i' } },
                { _id: { $in: matchedDoctorHospitalIds } } // 👈 Hospital found via Doctor's Speciality
            ];
        }

        let hospitals = await Hospital.find(query)
            .select('name address city state hospitalImage type averageRating totalReviews location isOnline')
            .lean();

        const dataWithDistance = await Promise.all(hospitals.map(async (hosp) => {
            let distance = 0;
            if (userLat && userLng && hosp.location?.lat && hosp.location?.lng) {
                distance = await getDistance(
                    parseFloat(userLat),
                    parseFloat(userLng),
                    hosp.location.lat,
                    hosp.location.lng
                );
            }
            return { 
                ...hosp, 
                distance: Number(distance.toFixed(2)) 
            };
        }));

        dataWithDistance.sort((a, b) => a.distance - b.distance);

        res.status(200).json({ 
            success: true, 
            count: dataWithDistance.length, 
            data: dataWithDistance 
        });

    } catch (error) { 
        console.error("Get Hospitals Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};


const getHospitalDetails = async (req, res) => {
    try {
        const { id } = req.params;
        
        const hospital = await Hospital.findById(id).select('-password -token').lean();
        
        // 🚨 CRITICAL CHECK: Block access if hospital is inactive by Admin
        if (!hospital || hospital.isActive === false) {
            return res.status(404).json({ success: false, message: "Hospital profile is inactive or not found." });
        }

        const reviews = await Review.find({ 
            targetId: id, 
            targetType: 'Hospital' 
        }).select('rating').lean();

        let averageRating = 4.5; 
        if (reviews.length > 0) {
            const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
            averageRating = Number((totalRating / reviews.length).toFixed(1)); 
        }

        const recentReviews = await Review.find({ targetId: id, targetType: 'Hospital' })
            .select('userName rating comment createdAt')
            .sort({ createdAt: -1 })
            .limit(3)
            .lean();

        const [wards, doctors, services] = await Promise.all([
            Ward.find({ hospitalId: id, isActive: true }),
            Doctor.find({ hospitalId: id, profileStatus: 'Approved', isActive: true }) // 👈 Added filter for active doctors
                .select('name speciality profileImage fees averageRating consultationStatus experienceYears about qualification'), 
            HospitalService.find({ hospitalId: id }) 
        ]);

        res.json({
            success: true,
            data: { 
                hospital: {
                    ...hospital,
                    rating: averageRating,           
                    totalReviews: reviews.length,
                    isOnline: hospital.isOnline ?? true // Sends online status to UI
                }, 
                wards, 
                doctors, 
                services,
                recentReviews                        
            }
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
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


// @desc    Confirm IPD Bed Booking (Fixes Bed 400 Error, Date Overlap Safety & Adds Special Services to Razorpay)
// @route   POST /user/hospital/book
// @access  Private (User)
const finalHospitalBooking = async (req, res) => {
    try {
        const userId = req.user.id;
        const { 
            hospitalId, 
            bedId, 
            startDate, 
            endDate, 
            triageLevel = 'Routine', 
            couponCode, 
            paymentMethod = 'COD', 
            patients,
            bookingReason,
            hasInsurance,
            insuranceNumber,
            companyName,
            insuranceType
        } = req.body;

        const rawSpecialServices = req.body.specialServices || req.body['specialServices[]'] || req.body.selectedServices || req.body.services;

        if (!hospitalId || !bedId || !startDate || !endDate) {
            return res.status(400).json({ success: false, message: "hospitalId, bedId, startDate, and endDate are required." });
        }

        const startMoment = moment(startDate, "YYYY-MM-DD").startOf('day');
        const endMoment = moment(endDate, "YYYY-MM-DD").startOf('day');

        if (!startMoment.isValid() || !endMoment.isValid() || endMoment.isBefore(startMoment)) {
            return res.status(400).json({ success: false, message: "Invalid date range." });
        }

        let stayDays = endMoment.diff(startMoment, 'days');
        if (stayDays <= 0) stayDays = 1;

        // 1. Fetch Bed
        const bed = await Bed.findOne({ _id: bedId, hospitalId }).populate('wardId');
        if (!bed) {
            return res.status(404).json({ success: false, message: "Selected bed not found in this hospital." });
        }

        if (bed.status === 'Maintenance') {
            return res.status(400).json({ success: false, message: "This bed is currently under maintenance. Please select another bed." });
        }

        const now = new Date();

        // 🚨 2. AUTO-RELEASE STALE/EXPIRED HOLDS ON THIS BED BEFORE CHECKING AVAILABILITY
        await Appointment.updateMany(
            {
                hospitalId,
                bedId,
                bookingType: 'Admission',
                paymentStatus: 'Pending',
                status: { $in: ['Pending', 'Hospital-Pending'] },
                admissionHoldExpiresAt: { $lt: now, $ne: null }
            },
            {
                $set: { status: 'Cancelled-By-Hospital', admissionHoldExpiresAt: null }
            }
        );

        // 🚨 3. RECYCLE USER RETRY: Check if CURRENT USER already has a pending attempt on this bed (e.g. Razorpay retry)
        const existingUserPending = await Appointment.findOne({
            userId,
            hospitalId,
            bedId,
            bookingType: 'Admission',
            paymentStatus: 'Pending',
            status: { $in: ['Pending', 'Hospital-Pending'] },
            startDate: { $gte: startMoment.toDate(), $lte: endMoment.toDate() }
        });

        // 🚨 4. REAL DATE-RANGE OVERLAP COLLISION CHECK (Fixes the 400 error!)
        const dateOverlapQuery = {
            hospitalId,
            bedId,
            bookingType: 'Admission',
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] },
            paymentStatus: { $in: ['Paid', 'Pending'] },
            startDate: { $lt: endMoment.toDate() },
            endDate: { $gt: startMoment.toDate() }
        };

        // Exclude current user's own pending retry attempt from blocking themselves
        if (existingUserPending) {
            dateOverlapQuery._id = { $ne: existingUserPending._id };
        }

        const activeOverlap = await Appointment.findOne(dateOverlapQuery);
        if (activeOverlap) {
            return res.status(400).json({ 
                success: false, 
                message: `Bed ${bed.bedNumber} is already booked by another patient from ${moment(activeOverlap.startDate).format("DD MMM")} to ${moment(activeOverlap.endDate).format("DD MMM")}. Please select another bed.` 
            });
        }

        const baseBedPrice = Number(bed.pricePerDay || 1000) * stayDays;

        // 🚨 5. UNIVERSAL SPECIAL SERVICES PARSER & DB VERIFICATION (Guarantees addition to total)
        let verifiedSpecialServices = [];
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
                        const p = Number(srv.price || 0);
                        specialServicesTotal += p;
                        verifiedSpecialServices.push({
                            serviceName: srv.serviceName,
                            price: p
                        });
                    }
                });
            }
        }

        // Subtotal = Base Bed Price + Verified Special Services Total
        const subtotal = baseBedPrice + specialServicesTotal;

        // 6. Coupon Discount Calculation
        let couponDiscount = 0;
        let couponId = null;
        if (couponCode && String(couponCode).trim() !== '') {
            const coupon = await Coupon.findOne({
                couponName: String(couponCode).trim().toUpperCase(),
                isActive: true,
                expiryDate: { $gte: new Date() }
            });

            if (coupon && subtotal >= (coupon.minOrderAmount || 0)) {
                couponDiscount = Math.min((subtotal * coupon.discountPercentage) / 100, coupon.maxDiscount || 9999);
                couponId = coupon._id;
            }
        }

        // Final amount payable (Includes Special Services)
        const totalPayable = Math.max(0, Math.round(subtotal - couponDiscount));
        const bookingId = existingUserPending ? existingUserPending.bookingId : `HKH-IPD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const isOnline = (paymentMethod === 'Online' || paymentMethod === 'online');

        // Safe Patient Parsing
        let patientList = [];
        if (typeof patients === 'string') {
            try { patientList = JSON.parse(patients); } catch(e) {}
        } else if (Array.isArray(patients)) {
            patientList = patients;
        }

        if (patientList.length === 0) {
            patientList = [{
                patientName: req.user.name || "Patient",
                patientAge: req.user.age || 30,
                gender: req.user.gender || "Male",
                relation: "Self"
            }];
        }

        // Insurance Document Upload Handling
        let insuranceDocPath = null;
        if (req.file) {
            insuranceDocPath = `/uploads/insurance/${req.file.filename}`;
        }

        const insurancePayload = {
            hasInsurance: Boolean(hasInsurance === 'true' || hasInsurance === true),
            insuranceNumber: insuranceNumber ? String(insuranceNumber).trim() : "",
            companyName: companyName ? String(companyName).trim() : "",
            insuranceType: insuranceType ? String(insuranceType).trim() : "",
            insuranceDocument: insuranceDocPath || (existingUserPending ? existingUserPending.insuranceDetails?.insuranceDocument : null),
            approvalStatus: (hasInsurance === 'true' || hasInsurance === true) ? 'Pending' : 'Rejected'
        };

        const holdDeadline = new Date(now.getTime() + 30 * 60 * 1000);

        let appointment;

        // If user is retrying, update the existing pending appointment instead of creating duplicates
        if (existingUserPending) {
            existingUserPending.totalAmount = totalPayable;
            existingUserPending.specialServices = verifiedSpecialServices;
            existingUserPending.insuranceDetails = insurancePayload;
            existingUserPending.admissionHoldExpiresAt = holdDeadline;
            existingUserPending.pricingBreakdown = {
                baseFee: baseBedPrice,
                visitCharges: 0,
                extraCharges: specialServicesTotal,
                discountAmount: couponDiscount,
                subtotal: subtotal,
                bookedDurationDays: stayDays,
                depositPaidOnBooking: totalPayable
            };
            appointment = await existingUserPending.save();
        } else {
            // Create New Admission Booking
            appointment = await Appointment.create({
                userId,
                hospitalId,
                bedId: bed._id,
                bedNumber: bed.bedNumber,
                wardName: bed.wardId?.name || "General Ward",
                bookingId,
                bookingType: 'Admission',
                bedBookingType: triageLevel === 'Emergency' ? 'Emergency-Bed' : 'General-Bed',
                triageLevel,
                startDate: startMoment.toDate(),
                endDate: endMoment.toDate(),
                stayDuration: stayDays,
                bookingReason: bookingReason || "Direct In-Patient Bed Admission",
                specialServices: verifiedSpecialServices,
                insuranceDetails: insurancePayload,
                status: isOnline ? 'Pending' : 'Hospital-Pending',
                paymentStatus: 'Pending',
                paymentMethod: isOnline ? 'Online' : 'COD',
                admissionHoldExpiresAt: holdDeadline,
                totalAmount: totalPayable,
                pricingBreakdown: {
                    baseFee: baseBedPrice,
                    visitCharges: 0,
                    extraCharges: specialServicesTotal,
                    discountAmount: couponDiscount,
                    subtotal: subtotal,
                    bookedDurationDays: stayDays,
                    depositPaidOnBooking: totalPayable
                },
                couponDetails: couponId ? {
                    couponId: couponId,
                    couponCode: String(couponCode).toUpperCase(),
                    discountValue: couponDiscount
                } : undefined,
                patients: patientList
            });
        }

        // Lock Bed to Reserved during payment
        bed.status = 'Reserved';
        await bed.save();

        // 🚨 7. RAZORPAY GATEWAY ORDER CREATION (Passes totalPayable which includes Special Services)
        if (isOnline) {
            const receiptId = `ipd_rcpt_${bookingId}`;
            const rzpOrder = await createRazorpayOrder(totalPayable, receiptId);

            return res.status(201).json({
                success: true,
                isOnlinePayment: true,
                key_id: process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID,
                amount: rzpOrder.amount, // Exact amount in paise (totalPayable * 100)
                currency: "INR",
                razorpayOrderId: rzpOrder.id,
                appointmentId: appointment._id,
                bookingId: appointment.bookingId,
                totalPayable: totalPayable,
                specialServicesIncluded: verifiedSpecialServices,
                data: appointment
            });
        }

        // 8. COD / Hospital Counter Flow
        res.status(201).json({
            success: true,
            isOnlinePayment: false,
            message: "In-Patient Admission booking created. Please pay deposit at Hospital Counter.",
            bookingId: appointment.bookingId,
            appointmentId: appointment._id,
            totalPayable: totalPayable,
            specialServicesIncluded: verifiedSpecialServices,
            data: appointment
        });

    } catch (error) {
        console.error("Final Hospital Booking Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// @desc    Verify Razorpay Signature for IPD Bed Booking (Locks Bed to Occupied & Decrements Ward Capacity)
// @route   POST /user/hospital/verify-payment
// @access  Private (User)
const verifyHospitalPayment = async (req, res) => {
    try {
        const { appointmentId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const userId = req.user.id;

        if (!appointmentId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ success: false, message: "Missing Razorpay payment verification parameters." });
        }

        const appointment = await Appointment.findOne({ _id: appointmentId, userId });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment record not found." });
        }

        if (appointment.paymentStatus === 'Paid') {
            return res.status(400).json({ success: false, message: "This booking is already paid." });
        }

        // 1. Verify Signature
        const isSignatureValid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
        if (!isSignatureValid) {
            return res.status(400).json({ success: false, message: "Payment signature verification failed." });
        }

        const now = new Date();
        const rzpDetails = await fetchAndMapRazorpayPayment(razorpay_payment_id, razorpay_signature);

        // 2. Lock Bed to Occupied & Decrement Ward
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
        appointment.status = 'In-Progress'; // Patient is actively admitted
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
            message: "Payment verified successfully! Bed is now Occupied and Admission is confirmed.",
            bookingId: appointment.bookingId,
            status: appointment.status,
            paymentStatus: appointment.paymentStatus,
            totalPaid: appointment.totalAmount,
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

// @desc    Get Available OPD Slots for Hospital Doctor (Timezone Aware, Dynamic Vendor Sync, Multiple Shifts & Blocked Reasons)
// @route   GET /user/hospital/doctors/:doctorId/opd-slots
// @access  Public
const getHospitalDoctorOpdSlots = async (req, res) => {
    try {
        const { doctorId } = req.params;
        const { date, hospitalId } = req.query; // date=YYYY-MM-DD

        if (!date || date.trim() === '') {
            return res.status(400).json({ success: false, message: "date query parameter is required (format: YYYY-MM-DD)." });
        }

        // Standardize Target Date in Indian Standard Time (IST)
        const targetDateStr = date.trim();
        const targetDate = moment(targetDateStr, "YYYY-MM-DD");
        if (!targetDate.isValid()) {
            return res.status(400).json({ success: false, message: "Invalid date format. Use YYYY-MM-DD." });
        }

        const doctorQuery = { _id: doctorId };
        if (hospitalId && mongoose.isValidObjectId(hospitalId)) {
            doctorQuery.hospitalId = hospitalId;
        }

        // 1. Fetch Doctor Profile & Base Config
        const doctor = await Doctor.findOne(doctorQuery)
            .select('name speciality fees slotDuration availability department leaves hospitalId')
            .lean();

        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found or not associated with this hospital." });
        }

        // 2. APPROVED LEAVES CHECK: Block entire day if doctor is on approved leave
        const isOnApprovedLeave = Array.isArray(doctor.leaves) && doctor.leaves.some(leave => {
            if (leave.status !== 'Approved') return false;
            const lStart = moment(leave.startDate).format("YYYY-MM-DD");
            const lEnd = moment(leave.endDate).format("YYYY-MM-DD");
            return targetDateStr >= lStart && targetDateStr <= lEnd;
        });

        if (isOnApprovedLeave) {
            return res.status(200).json({
                success: true,
                isClosed: true,
                reason: `Dr. ${doctor.name} is on approved leave on ${targetDateStr}. Please select another date.`,
                slots: []
            });
        }

        // 3. FETCH VENDOR AVAILABILITY (Without hardcoded vendorType constraint for maximum compatibility)
        const availabilityConfig = await Availability.findOne({ vendorId: doctor._id }).lean();

        // Check if date is globally marked as holiday/blocked
        if (availabilityConfig && Array.isArray(availabilityConfig.blockedDates)) {
            const isDateBlocked = availabilityConfig.blockedDates.some(d => moment(d).format("YYYY-MM-DD") === targetDateStr);
            if (isDateBlocked) {
                return res.status(200).json({
                    success: true,
                    isClosed: true,
                    reason: `OPD is closed on ${targetDateStr} (Holiday / Off-day).`,
                    slots: []
                });
            }
        }

        // Helper function: Normalize any time string (12H or 24H) to standard "HH:mm" (24H format)
        const normalizeTo24H = (timeStr) => {
            if (!timeStr) return "";
            const clean = String(timeStr).trim();
            if (/^\d{1,2}:\d{2}$/.test(clean)) {
                const [h, m] = clean.split(':').map(Number);
                return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            }
            const parsed = moment(clean, ["hh:mm A", "h:mm A", "HH:mm", "H:mm", "hh:mma", "h:mma"]);
            return parsed.isValid() ? parsed.format("HH:mm") : clean;
        };

        // 4. MAP DYNAMIC SHIFTS (Resolves Multiple Daily Shifts and End-Time cutoff issues)
        const dayName = targetDate.format('ddd'); // 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'
        let shiftsToProcess = [];

        // Check day-specific shifts from doctor.availability array
        if (Array.isArray(doctor.availability) && doctor.availability.length > 0) {
            const dayMatches = doctor.availability.filter(a => a.day === dayName && a.startTime && a.endTime);
            if (dayMatches.length > 0) {
                shiftsToProcess = dayMatches.map(s => ({
                    startTime: normalizeTo24H(s.startTime),
                    endTime: normalizeTo24H(s.endTime)
                }));
            }
        }

        // Fallback to Availability document if day-specific array is empty
        if (shiftsToProcess.length === 0 && availabilityConfig && availabilityConfig.startTime && availabilityConfig.endTime) {
            shiftsToProcess.push({
                startTime: normalizeTo24H(availabilityConfig.startTime),
                endTime: normalizeTo24H(availabilityConfig.endTime)
            });
        }

        // Absolute default fallback if unconfigured
        if (shiftsToProcess.length === 0) {
            shiftsToProcess.push({ startTime: "09:00", endTime: "18:00" });
        }

        // 5. FETCH BOOKED APPOINTMENTS FOR THIS DAY
        const dayStart = targetDate.clone().startOf('day').toDate();
        const dayEnd = targetDate.clone().endOf('day').toDate();

        const bookedAppointments = await Appointment.find({
            doctorId: doctor._id,
            bookingType: 'OPD',
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] },
            appointmentDate: { $gte: dayStart, $lte: dayEnd }
        }).select('appointmentTime').lean();

        const bookedTimes24 = bookedAppointments.map(a => normalizeTo24H(a.appointmentTime));

        // 6. BUILD BLOCKED SLOTS & PREMIUM MAPS SAFELY
        const unavailableSlots24 = (availabilityConfig?.unavailableSlots || []).map(normalizeTo24H);

        // Map blocked slots with specific reasons matching targetDate safely
        const blockedReasonsMap = {};
        (availabilityConfig?.blockedSlotsWithReason || []).forEach(item => {
            const itemDateStr = moment(item.date).format("YYYY-MM-DD");
            if (itemDateStr === targetDateStr) {
                const normalizedTime = normalizeTo24H(item.time);
                blockedReasonsMap[normalizedTime] = item.reason || "Doctor unavailable";
            }
        });

        // Map premium slot fees
        const premiumSlotsMap = {};
        (availabilityConfig?.premiumSlots || []).forEach(item => {
            const normalizedTime = normalizeTo24H(item.time);
            premiumSlotsMap[normalizedTime] = Number(item.extraFee || 0);
        });

        // 7. SLOT GENERATION ENGINE (Timezone Aware for IST + Preserves Block Reasons)
        const duration = Math.max(5, Number(doctor.slotDuration || 15));
        const baseConsultationFee = Number(doctor.fees?.clinic || 500);
        const slots = [];

        // Exact Indian Standard Time (IST) Clock
        const nowIST = moment().utcOffset("+05:30");
        const isToday = targetDateStr === nowIST.format("YYYY-MM-DD");

        for (const shift of shiftsToProcess) {
            const [startH, startM] = shift.startTime.split(':').map(Number);
            const [endH, endM] = shift.endTime.split(':').map(Number);

            let currentMinutes = startH * 60 + startM;
            const endMinutes = endH * 60 + endM;

            while (currentMinutes + duration <= endMinutes) {
                const h = Math.floor(currentMinutes / 60);
                const m = currentMinutes % 60;
                const timeStr24 = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                const timeFormatted = moment(timeStr24, "HH:mm").format("hh:mm A");

                // Shift categorization
                let category = "Morning";
                if (h >= 12 && h < 17) category = "Afternoon";
                else if (h >= 17) category = "Evening";

                // Check past status using strict IST time
                const slotMomentIST = moment.utc(`${targetDateStr} ${timeStr24}`, "YYYY-MM-DD HH:mm").utcOffset("+05:30");
                const isPast = isToday && slotMomentIST.isBefore(nowIST);

                const isAlreadyBooked = bookedTimes24.includes(timeStr24);
                const blockReason = blockedReasonsMap[timeStr24] || null;
                const isBlockedWithReason = Boolean(blockReason);
                const isManuallyUnavailable = unavailableSlots24.includes(timeStr24);

                // 🚨 CRITICAL FIX: Status Priority Logic (Block Reason preserved even if slot passed)
                let status = "Available";
                let isAvailable = true;

                if (isBlockedWithReason) {
                    status = "Blocked";
                    isAvailable = false;
                } else if (isManuallyUnavailable) {
                    status = "Unavailable";
                    isAvailable = false;
                } else if (isAlreadyBooked) {
                    status = "Booked";
                    isAvailable = false;
                } else if (isPast) {
                    status = "Past";
                    isAvailable = false;
                }

                // Premium Slot Calculation
                const extraFee = premiumSlotsMap[timeStr24] || 0;
                const isPremium = extraFee > 0;
                const totalFee = baseConsultationFee + extraFee;

                slots.push({
                    time: timeFormatted,
                    time24: timeStr24,
                    category,
                    isAvailable,
                    status,
                    isPremium,
                    premiumFee: extraFee,
                    baseFee: baseConsultationFee,
                    totalFee,
                    blockReason: blockReason || (status === "Unavailable" ? "Slot disabled by doctor" : null)
                });

                currentMinutes += duration;
            }
        }

        // Avoid duplicate slots if overlapping shifts exist
        const uniqueSlots = [];
        const seenTimes = new Set();
        for (const s of slots) {
            if (!seenTimes.has(s.time24)) {
                seenTimes.add(s.time24);
                uniqueSlots.push(s);
            }
        }

        res.status(200).json({
            success: true,
            isClosed: false,
            date: targetDateStr,
            doctor: {
                id: doctor._id,
                name: doctor.name,
                speciality: doctor.speciality,
                cabinRoom: doctor.department?.roomNumber || "Cabin 1",
                baseOpdFee: baseConsultationFee,
                slotDurationMinutes: duration
            },
            totalSlots: uniqueSlots.length,
            availableSlotsCount: uniqueSlots.filter(s => s.isAvailable).length,
            slots: uniqueSlots
        });

    } catch (error) {
        console.error("Get Hospital Doctor OPD Slots Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// @desc    Calculate OPD Consultation Checkout Summary (Base Fee + Premium Slot Surcharge + Coupons)
// @route   POST /user/hospital/opd/checkout-summary
// @access  Private (User)
const getHospitalOpdCheckoutSummary = async (req, res) => {
    try {
        const userId = req.user.id;
        const { hospitalId, doctorId, appointmentDate, appointmentTime, couponCode } = req.body;

        if (!hospitalId || !doctorId || !appointmentDate || !appointmentTime) {
            return res.status(400).json({
                success: false,
                message: "hospitalId, doctorId, appointmentDate, and appointmentTime are required."
            });
        }

        const doctor = await Doctor.findOne({ _id: doctorId, hospitalId, profileStatus: 'Approved', isActive: true });
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found or inactive in this hospital." });
        }

        const baseFee = Number(doctor.fees?.clinic !== undefined ? doctor.fees.clinic : 0);
        let finalBaseFee = baseFee;
        let isSubscriptionApplied = false;
        let planName = "";
        let userSubscriptionId = null;

        if (baseFee > 0) {
            const consultBenefit = await checkAndApplyBenefit(userId, 'freeDoctorAppointmentsCount', baseFee);
            if (consultBenefit.isApplied) {
                finalBaseFee = 0;
                isSubscriptionApplied = true;
                planName = consultBenefit.planName || "Active Care Plan";
                userSubscriptionId = consultBenefit.subId || null;
            }
        }

        // 🚨 Dynamic Premium Slot Check for selected appointmentTime
        let premiumFee = 0;
        const availabilityConfig = await Availability.findOne({ vendorId: doctorId, vendorType: 'Doctor' }).lean();
        if (availabilityConfig && Array.isArray(availabilityConfig.premiumSlots)) {
            const cleanTime = String(appointmentTime).trim();
            const matchedPremium = availabilityConfig.premiumSlots.find(p => p.time === cleanTime);
            if (matchedPremium && Number(matchedPremium.extraFee || 0) > 0) {
                premiumFee = Number(matchedPremium.extraFee);
            }
        }

        const subtotal = finalBaseFee + premiumFee;

        // Apply Coupon Discount
        let discount = 0;
        let couponDetailsObj = null;

        if (couponCode && subtotal > 0) {
            const coupon = await Coupon.findOne({
                couponName: String(couponCode).toUpperCase().trim(),
                isActive: true,
                expiryDate: { $gte: new Date() },
                $or: [
                    { vendorId: hospitalId },
                    { isAdminCreated: true, vendorType: { $in: ['Hospital', 'Doctor', 'All'] } }
                ]
            });

            if (coupon && subtotal >= (coupon.minOrderAmount || 0)) {
                let disc = (subtotal * coupon.discountPercentage) / 100;
                if (coupon.maxDiscount && disc > coupon.maxDiscount) disc = coupon.maxDiscount;
                discount = Math.round(disc);
                couponDetailsObj = {
                    couponId: coupon._id,
                    couponCode: coupon.couponName,
                    discountValue: discount
                };
            }
        }

        const totalPayable = Math.max(0, subtotal - discount);
        const isCodAvailable = await isCodEnabled('Hospital', userId);

        res.status(200).json({
            success: true,
            data: {
                bookingType: 'OPD',
                baseFee: finalBaseFee,
                originalBaseFee: baseFee,
                premiumSlotFee: premiumFee,       // 👈 Explicit Premium Slot Surcharge
                isPremiumSlot: premiumFee > 0,
                extraCharges: premiumFee,
                discount,
                subtotal,
                totalPayable,
                isCodAvailable,
                couponDetails: couponDetailsObj,
                subscriptionDetails: {
                    isSubscriptionApplied,
                    userSubscriptionId,
                    planName
                }
            }
        });

    } catch (error) {
        console.error("Get Hospital OPD Checkout Summary Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// @desc    Patient Books Hospital OPD Consultation (With Concurrent Double-Booking & Slot Validation Protection)
// @route   POST /user/hospital/opd/book
// @access  Private (User)
const bookHospitalOpdAppointment = async (req, res) => {
    try {
        const userId = req.user.id;
        const { hospitalId, doctorId, appointmentDate, appointmentTime, paymentMethod = 'COD', patients } = req.body;

        if (!hospitalId || !doctorId || !appointmentDate || !appointmentTime) {
            return res.status(400).json({ success: false, message: "hospitalId, doctorId, appointmentDate (YYYY-MM-DD), and appointmentTime are required." });
        }

        const targetDate = moment(appointmentDate.trim(), "YYYY-MM-DD").startOf('day');
        if (!targetDate.isValid()) {
            return res.status(400).json({ success: false, message: "Invalid appointmentDate format. Use YYYY-MM-DD." });
        }

        // 1. Verify Doctor & Hospital Association
        const doctor = await Doctor.findOne({ _id: doctorId, hospitalId })
            .select('name speciality fees department leaves slotDuration')
            .lean();

        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found or not associated with this hospital." });
        }

        const targetDateStr = targetDate.format("YYYY-MM-DD");

        // 2. CHECK APPROVED LEAVES: Block booking if doctor is on approved leave
        const isOnLeave = Array.isArray(doctor.leaves) && doctor.leaves.some(l => {
            if (l.status !== 'Approved') return false;
            const s = moment(l.startDate).format("YYYY-MM-DD");
            const e = moment(l.endDate).format("YYYY-MM-DD");
            return targetDateStr >= s && targetDateStr <= e;
        });

        if (isOnLeave) {
            return res.status(400).json({ success: false, message: `Dr. ${doctor.name} is on approved leave on ${targetDateStr}. Please select another date.` });
        }

        // 3. 🚨 CONCURRENT DOUBLE-BOOKING GUARD: Check if slot was already taken in the last few seconds
        const dayStart = targetDate.clone().startOf('day').toDate();
        const dayEnd = targetDate.clone().endOf('day').toDate();

        const isSlotAlreadyTaken = await Appointment.findOne({
            doctorId,
            hospitalId,
            bookingType: 'OPD',
            appointmentDate: { $gte: dayStart, $lte: dayEnd },
            appointmentTime: appointmentTime.trim(),
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] }
        });

        if (isSlotAlreadyTaken) {
            return res.status(409).json({ 
                success: false, 
                message: `The slot ${appointmentTime} on ${targetDateStr} was just booked by another patient. Please select another slot.` 
            });
        }

        // 4. CHECK IF SLOT WAS BLOCKED BY DOCTOR WITH REASON
        const availability = await Availability.findOne({ vendorId: doctor._id }).lean();
        if (availability) {
            const isBlockedByDoctor = (availability.blockedSlotsWithReason || []).some(b => {
                return moment(b.date).format("YYYY-MM-DD") === targetDateStr && b.time === appointmentTime.trim();
            });

            if (isBlockedByDoctor) {
                return res.status(400).json({ success: false, message: `The slot ${appointmentTime} is blocked by doctor for emergency duties. Please choose another slot.` });
            }
        }

        // 5. Generate Daily Sequential Token Number
        const dailyCount = await Appointment.countDocuments({
            hospitalId,
            doctorId,
            appointmentDate: { $gte: dayStart, $lte: dayEnd },
            bookingType: 'OPD'
        });
        const assignedToken = dailyCount + 1;

        const baseConsultationFee = Number(doctor.fees?.clinic || 500);
        const cabinNumber = doctor.department?.roomNumber || "Cabin 1";
        const bookingId = `HKH-OPD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        // 6. Create Confirmed / Pending Appointment
        const isOnline = (paymentMethod === 'Online' || paymentMethod === 'online');
        const initialStatus = isOnline ? 'Pending' : 'Hospital-Pending'; // If online, becomes Confirmed after signature verification

        const appointment = await Appointment.create({
            userId,
            hospitalId,
            doctorId,
            bookingId,
            bookingType: 'OPD',
            tokenNumber: assignedToken,
            opdRoomNumber: cabinNumber,
            appointmentDate: targetDate.toDate(),
            appointmentTime: appointmentTime.trim(),
            status: initialStatus,
            paymentStatus: 'Pending',
            paymentMethod: isOnline ? 'Online' : 'COD',
            totalAmount: baseConsultationFee,
            pricingBreakdown: {
                baseFee: baseConsultationFee,
                subtotal: baseConsultationFee
            },
            patients: Array.isArray(patients) && patients.length > 0 ? patients : [{
                patientName: req.user.name || "Patient",
                patientAge: req.user.age || 30,
                gender: req.user.gender || "Male",
                relation: "Self"
            }]
        });

        res.status(201).json({
            success: true,
            message: `OPD Consultation booked successfully. Token #${assignedToken} allocated.`,
            tokenNumber: assignedToken,
            cabinRoom: cabinNumber,
            bookingId,
            status: appointment.status,
            totalAmount: baseConsultationFee,
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