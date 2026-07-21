const Hospital = require('../../../models/Hospital');
const Ward = require('../../../models/Ward');
const Bed = require('../../../models/Bed');
const Appointment = require('../../../models/Appointment');
const HospitalService = require('../../../models/HospitalService');
const Coupon = require('../../../models/Coupon');
const Doctor = require('../../../models/Doctor');
const User = require('../../../models/User');
const BedRescheduleLimit = require('../../../models/BedRescheduleLimit'); // 👈 Ye import hona zaroori hai!
const UserSubscription = require('../../../models/UserSubscription');

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


// 1. LIST HOSPITALS (Screenshot 18, 19)
const getHospitals = async (req, res) => {
    try {
        const { search, city, userLat, userLng } = req.body;

        // Strictly filters: Only APPROVED and ACTIVE (isActive: true) hospitals
        let query = { profileStatus: 'Approved', isActive: true };
        if (city) query.city = { $regex: city, $options: 'i' };
        if (search) query.name = { $regex: search, $options: 'i' };

        // Projecting 'isOnline' in list query response
        let hospitals = await Hospital.find(query)
            .select('name address city state hospitalImage type averageRating totalReviews location isOnline')
            .lean();

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

        dataWithDistance.sort((a, b) => a.distance - b.distance);

        res.json({ success: true, count: dataWithDistance.length, data: dataWithDistance });
    } catch (error) { res.status(500).json({ message: error.message }); }
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
        const { startDate, endDate } = req.query; // Frontend query parameters

        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, message: "Please select date range." });
        }

        // Timezone offsets door karne ke liye startOf/endOf standard parse kiya hai
        const userStart = moment(startDate).startOf('day').toDate();
        const userEnd = moment(endDate).endOf('day').toDate();

        // Ward ke sabhi beds ko fetch kiya
        const allBeds = await Bed.find({ wardId }).lean();
        const bedIds = allBeds.map(b => b._id);

        // Strictly checking overlapping bookings for target beds
        const overlaps = await Appointment.find({
            bedId: { $in: bedIds },
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] },
            $and: [
                { startDate: { $lte: userEnd } },
                { endDate: { $gte: userStart } }
            ]
        }).select('bedId');

        // Safe array map (handling null/undefined bedId check)
        const bookedIds = overlaps.filter(o => o.bedId).map(o => o.bedId.toString());

        // Dynamic status mapping logic
        const data = allBeds.map(bed => {
            let dynamicStatus = bed.status;

            if (bookedIds.includes(bed._id.toString())) {
                dynamicStatus = 'Occupied'; // Agar same date ko overlap hai toh block hoga
            } else if (bed.status === 'Occupied' || bed.status === 'Reserved') {
                dynamicStatus = 'Available'; // Past/Future matches ke liye display available hoga
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

        // FIX: wardName database string compare karne ke bajaye direct Bed ObjectIds check karega
        const overlappingAppointments = await Appointment.find({
            hospitalId,
            bedId: { $in: bedIds },
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] },
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
// --- 2. UPDATED CHECKOUT (Updated with COD Check) ---
const getHospitalCheckoutSummary = async (req, res) => {
    try {
        let body = { ...req.body };

        // 1. SAFE MULTIPART PARSER
        if (typeof body.patients === 'string') {
            try { body.patients = JSON.parse(body.patients); } catch (e) { body.patients = []; }
        }
        if (typeof body.address === 'string') {
            try { body.address = JSON.parse(body.address); } catch (e) { body.address = null; }
        }
        if (typeof body.specialServices === 'string') {
            try { body.specialServices = JSON.parse(body.specialServices); } catch (e) { body.specialServices = []; }
        }

        const { 
            hospitalId, 
            bedId, 
            startDate, 
            endDate, 
            couponCode, 
            patients = [], 
            address = null,
            specialServices = []
        } = body;

        // 2. Mandatory parameters validation check
        if (!hospitalId || !bedId || !startDate || !endDate) {
            return res.status(400).json({ 
                success: false, 
                message: "Validation Error: Required fields (hospitalId, bedId, startDate, endDate) are missing." 
            });
        }

        // 🚨 SECURITY LOCK: Fetch dynamic COD toggle state from admin panel
        const isCodAllowed = await isCodEnabled('Hospital');

        // 3. Fetch Bed and prevent null reference crashes
        const bed = await Bed.findById(bedId);
        if (!bed) {
            return res.status(404).json({ success: false, message: "Selected Bed not found in the system." });
        }

        // 4. Safe stay duration calculation using moment
        const start = moment(startDate).startOf('day');
        const end = moment(endDate).endOf('day');
        const stayDuration = end.diff(start, 'days') + 1;

        if (isNaN(stayDuration) || stayDuration <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Date validation error: Check-out date must be scheduled after check-in date." 
            });
        }

        const dailyRate = bed.pricePerDay || 500;
        const baseFee = dailyRate * stayDuration;

        let originalBaseFee = baseFee; 
        let finalBaseFee = baseFee;
        let isSubscriptionApplied = false;
        let planName = "";
        let userSubscriptionId = null;

        // 5. Subscription benefit check
        const { checkAndApplyBenefit } = require('../../../utils/subscriptionBenefitHelper');
        const admissionBenefit = await checkAndApplyBenefit(req.user.id, 'freeHospitalStaysCount', baseFee);
        
        if (admissionBenefit.isApplied) {
            finalBasePrice = 0; // Price waived to 0
            isSubscriptionApplied = true;

            const UserSubscription = require('../../../models/UserSubscription');
            const activeSub = await UserSubscription.findOne({
                userId: req.user.id,
                status: 'Active',
                endDate: { $gt: new Date() }
            }).populate('planId', 'name');

            if (activeSub) {
                planName = activeSub.planId?.name || "Premium Care Plan";
                userSubscriptionId = activeSub._id;
            }
        }

        // 6. Compute Special services if selected
        const servicesTotal = specialServices.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
        let subtotal = finalBaseFee + servicesTotal;

        // 7. Calculate dynamic coupon discount
        let discount = 0;
        if (couponCode) {
            const coupon = await Coupon.findOne({ 
                couponName: couponCode.toUpperCase(), 
                isActive: true,
                expiryDate: { $gte: new Date() }
            });
            if (coupon && subtotal >= coupon.minOrderAmount) {
                discount = Math.min((subtotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
            }
        }

        res.json({
            success: true,
            data: {
                baseFee: finalBaseFee,
                originalBaseFee, 
                servicesTotal,
                discount: Math.round(discount),
                subtotal: Math.round(subtotal),
                totalPayable: Math.round(subtotal - discount),
                stayDuration,
                patients,
                address,
                isCodAvailable: isCodAllowed, // 👈 Dynamic indicator added
                subscriptionDetails: {
                    isSubscriptionApplied,
                    userSubscriptionId,
                    planName
                }
            }
        });

    } catch (error) {
        console.error("getHospitalCheckoutSummary Exception:", error);
        res.status(500).json({ success: false, message: "Internal checkout summary parsing error: " + error.message });
    }
};



// --- 3. FINAL RANGE BOOKING ---
// 3. FINAL RANGE BOOKING (Complete dynamic flow with strict overlap check & secure coupon array updates)
// --- 3. FINAL RANGE BOOKING (Stricter Overlap & COD Checks) ---
const finalHospitalBooking = async (req, res) => {
    try {
        const { 
            hospitalId, 
            bedId, 
            startDate, 
            endDate, 
            patients, 
            address,
            bookingReason,      
            hasInsurance,       
            paymentMethod,
            couponCode 
        } = req.body;

        const userId = req.user.id;

        // 🚨 STRICTOR COD VALIDATION
        if (paymentMethod === 'COD') {
            const isCodAllowed = await isCodEnabled('Hospital');
            if (!isCodAllowed) {
                return res.status(400).json({
                    success: false,
                    message: "Cash on Delivery is currently disabled for Hospital Admissions. Please pay online to complete your booking."
                });
            }
        }

        // 1. Process and resolve Insurance Details
        let finalInsuranceData = {
            hasInsurance: false,
            insuranceNumber: "",
            companyName: "",
            insuranceType: "",
            insuranceDocument: null
        };

        const isInsuranceApplied = hasInsurance === 'true' || hasInsurance === true;

        if (isInsuranceApplied) {
            const userProfile = await User.findById(userId);
            if (!userProfile) {
                return res.status(404).json({ success: false, message: "User profile not found." });
            }

            finalInsuranceData.hasInsurance = true;

            if (req.file) {
                finalInsuranceData.insuranceDocument = `/uploads/insurance/${req.file.filename}`;
                finalInsuranceData.insuranceNumber = req.body.insuranceNumber || "";
                finalInsuranceData.companyName = req.body.companyName || "";
                finalInsuranceData.insuranceType = req.body.insuranceType || "";
            } else if (userProfile.insuranceDetails && userProfile.insuranceDetails.hasInsurance && userProfile.insuranceDetails.insuranceDocument) {
                finalInsuranceData.insuranceDocument = userProfile.insuranceDetails.insuranceDocument;
                finalInsuranceData.insuranceNumber = userProfile.insuranceDetails.insuranceNumber || "";
                finalInsuranceData.companyName = userProfile.insuranceDetails.companyName || "";
                finalInsuranceData.insuranceType = userProfile.insuranceDetails.insuranceType || "";
            } else {
                return res.status(400).json({ 
                    success: false, 
                    message: "Validation Error: Please upload an insurance document file or complete your insurance profile settings to proceed with cashless checkout." 
                });
            }
        }

        // 2. Fetch Target Bed
        const bed = await Bed.findById(bedId);
        if (!bed) {
            return res.status(404).json({ success: false, message: "Selected Bed not found in the system." });
        }
        if (bed.status === 'Maintenance') {
            return res.status(400).json({ success: false, message: "Selected bed is currently under maintenance." });
        }

        const ward = await Ward.findById(bed.wardId);
        const wardName = ward ? ward.name : "N/A";

        // 3. Dates validation & Overlapping booking check
        const start = moment(startDate).startOf('day').toDate();
        const end = moment(endDate).endOf('day').toDate();
        const stayDuration = moment(end).diff(moment(start), 'days') + 1;

        if (stayDuration <= 0) {
            return res.status(400).json({ success: false, message: "End Date must be after Start Date." });
        }

        const isAlreadyBooked = await Appointment.findOne({
            bedId: bedId,
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending', 'Discharge-Pending'] },
            $and: [
                { startDate: { $lte: end } },
                { endDate: { $gte: start } }
            ]
        });

        if (isAlreadyBooked) {
            return res.status(400).json({
                success: false,
                message: "This bed is already booked or occupied for the selected date range. Please select another bed or date range."
            });
        }

        // 4. Base Price Calculation
        const basePrice = bed.pricePerDay * stayDuration;
        let originalBasePrice = basePrice;
        let finalBasePrice = basePrice;
        let isSubscriptionApplied = false;
        let planName = "";
        let userSubscriptionId = null;

        // 5. Subscription benefit check
        const admissionBenefit = await checkAndApplyBenefit(userId, 'freeHospitalStaysCount', basePrice);
        if (admissionBenefit.isApplied) {
            finalBasePrice = 0; // Price waived
            isSubscriptionApplied = true;

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

        // 6. Coupon Processing
        let couponDiscount = 0;
        let couponDetailsObj = null;

        if (couponCode) {
            const coupon = await Coupon.findOne({
                couponName: couponCode.toUpperCase(),
                isActive: true,
                expiryDate: { $gte: new Date() },
                $or: [
                    { vendorId: hospitalId },
                    { isAdminCreated: true, vendorType: { $in: ['Hospital', 'All'] } }
                ]
            });

            if (coupon && finalBasePrice >= coupon.minOrderAmount) {
                const userUsage = coupon.usedBy.find(u => u.userId.toString() === userId.toString());
                const usageCount = userUsage ? userUsage.usageCount : 0;

                if (usageCount < coupon.maxUsagePerUser) {
                    let discount = (finalBasePrice * coupon.discountPercentage) / 100;
                    if (discount > coupon.maxDiscount) discount = coupon.maxDiscount;

                    couponDiscount = Math.round(discount);
                    couponDetailsObj = {
                        couponId: coupon._id,
                        couponCode: coupon.couponName,
                        discountValue: couponDiscount
                    };
                }
            }
        }

        const totalAmount = finalBasePrice - couponDiscount;

        // 7. Generate Unique Booking ID
        const tempBookingId = `HKH-${Date.now().toString().slice(-6)}${Math.floor(100 + Math.random() * 900)}`;

        // 8. Handle Online Payments via Razorpay
        let rzpOrder = null;
        if (paymentMethod !== 'COD' && totalAmount > 0) {
            rzpOrder = await createRazorpayOrder(totalAmount, `receipt_${tempBookingId}`);
        }

        // 9. Parse patients and address inputs
        const parsedPatients = typeof patients === 'string' ? JSON.parse(patients) : patients;
        const parsedAddress = typeof address === 'string' ? JSON.parse(address) : address;

        // 10. Save Admission Booking
        const booking = await Appointment.create({
            bookingId: tempBookingId,
            userId,
            hospitalId,
            bedId,
            wardName,
            bedNumber: bed.bedNumber,
            bookingType: 'Admission',
            patients: parsedPatients,
            address: parsedAddress,
            startDate: start,
            endDate: end,
            stayDuration,
            
            // Screen fields &resolved insurance metadata
            bookingReason: bookingReason || "",
            insuranceDetails: finalInsuranceData,

            // Pricing structure
            pricingBreakdown: {
                baseFee: finalBasePrice,
                originalBaseFee: originalBasePrice,
                discountAmount: couponDiscount,
                subtotal: finalBasePrice
            },
            couponDetails: couponDetailsObj,
            totalAmount: Math.round(totalAmount),
            
            paymentMethod: paymentMethod || 'Online',
            paymentStatus: paymentMethod === 'COD' || totalAmount === 0 ? 'Pending' : 'Pending',
            status: paymentMethod === 'COD' || totalAmount === 0 ? 'Hospital-Pending' : 'Pending',

            // Subscription timeline audit
            treatmentHistory: [{
                action: 'Initial-Assignment',
                notes: `Admitted via Hospital Booking Flow.`,
                subscriptionDetails: {
                    isSubscriptionApplied,
                    userSubscriptionId,
                    planName
                },
                timestamp: new Date()
            }]
        });

        // 11. Handle COD / Free bypass flow directly
        if (paymentMethod === 'COD' || totalAmount === 0) {
            if (isSubscriptionApplied) {
                await deductBenefitCount(userId, 'freeHospitalStaysCount');
            }

            if (couponDetailsObj) {
                await Coupon.findByIdAndUpdate(couponDetailsObj.couponId, {
                    $push: { usedBy: { userId, usageCount: 1 } }
                });
            }

            // Lock bed status & update Ward occupancy
            bed.status = 'Occupied';
            await bed.save();
            await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: -1 } });

            await notifyAdminsAndVendor(
                hospitalId,
                'hospital',
                "New Admission Requested (COD)!",
                `Admission request #${tempBookingId} has been successfully submitted.`,
                { bookingId: booking._id.toString(), type: 'new_hospital_booking' }
            );

            return res.status(201).json({
                success: true,
                message: "Admission request successfully submitted!",
                data: booking
            });
        }

        // 12. Online payment workflow (Razorpay Order details returned)
        res.status(201).json({
            success: true,
            message: "Razorpay order created. Complete payment to confirm.",
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount,
            razorpayOrderId: rzpOrder.id,
            bookingId: tempBookingId,
            appointmentId: booking._id
        });

    } catch (error) {
        console.error("Critical finalHospitalBooking Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// 🚨 NEW CONTROLLER: VERIFY HOSPITAL BOOKING PAYMENT SIGNATURE
// endpoint: POST /user/hospital/verify-payment
const verifyHospitalPayment = async (req, res) => {
    try {
        const { appointmentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

        if (!appointmentId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(400).json({ 
                success: false, 
                message: "All payment verification tokens are mandatory." 
            });
        }

        const isVerified = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        if (!isVerified) {
            return res.status(400).json({ 
                success: false, 
                message: "Signature verification failed. Invalid transaction signature." 
            });
        }

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        const rzpDetails = await fetchAndMapRazorpayPayment(razorpayPaymentId, razorpaySignature);

        if (appointment.bedId) {
            const bed = await Bed.findById(appointment.bedId).populate('wardId');
            if (bed) {
                if (bed.wardId) {
                    await Ward.findByIdAndUpdate(bed.wardId._id, { $inc: { availableBeds: -1 } });
                }
                await Bed.findByIdAndUpdate(appointment.bedId, { status: 'Reserved' });
            }
        }

        appointment.status = 'Hospital-Pending';
        appointment.paymentStatus = 'Paid';
        appointment.transactionId = razorpayPaymentId;
        appointment.paymentDetails = rzpDetails; 
        await appointment.save();

        // 🚨 SUBSCRIPTION DEDUCTION: Online payment successful hone par doctor count minus karein
        if (appointment.doctorId) {
            await deductBenefitCount(appointment.userId, 'freeDoctorAppointmentsCount');
        }

        res.json({
            success: true,
            message: "Payment successfully verified & Admission request submitted!",
            data: appointment
        });

    } catch (error) {
        console.error("Signature Verification Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


const cancelBedBooking = async (req, res) => {
    try {
        const { id } = req.params; 
        const { reason } = req.body;

        const appt = await Appointment.findOne({ _id: id, userId: req.user.id, bookingType: 'Admission' });
        if (!appt) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        const terminalStates = ['In-Progress', 'Completed', 'Cancelled-By-User', 'Cancelled-By-Hospital', 'No-Show'];
        if (terminalStates.includes(appt.status)) {
            return res.status(400).json({ success: false, message: "Cannot cancel booking in its current state." });
        }

        const globalConfig = await BedRescheduleLimit.findOne();
        const maxLimit = globalConfig ? globalConfig.maxLimit : 2;

        const currentCancelCount = appt.cancellationCount || 0;
        const currentRescheduleCount = appt.rescheduleCount || 0; 

        if (currentRescheduleCount >= maxLimit) {
            return res.status(400).json({
                success: false,
                message: `Cancellation Blocked: Reschedule limit (${maxLimit}) has expired.`
            });
        }

        if (currentCancelCount >= maxLimit) {
            return res.status(400).json({
                success: false,
                message: `Cancellation Blocked: Maximum cancellations (${maxLimit}) reached.`
            });
        }

        // 🚨 DYNAMIC POLICY EVALUATION
        const policyResult = await processCancellationRefund(appt, 'Hospital');

        if (appt.bedId) {
            await Bed.findByIdAndUpdate(appt.bedId, { $set: { status: 'Available' } });
            await Ward.findOneAndUpdate(
                { name: appt.wardName, hospitalId: appt.hospitalId },
                { $inc: { availableBeds: 1 } }
            );
        }

        appt.status = 'Cancelled-By-User';
        appt.cancellationCount = currentCancelCount + 1;
        appt.cancelReason = reason || "Cancelled by User";
        
        appt.pricingBreakdown.cancellationFeeApplied = policyResult.cancellationFee;
        appt.paymentStatus = 'Refund-Initiated';

        await appt.save();

        // Subscription benefit refund check
        if (appt.subscriptionDetails?.isSubscriptionApplied && appt.pricingBreakdown?.baseFee === 0) {
            await refundBenefitCount(appt.userId, 'freeHospitalStaysCount');
        }

        res.json({
            success: true,
            message: policyResult.cancellationFee > 0
                ? `Booking cancelled successfully. A cancellation fee of ₹${policyResult.cancellationFee} was applied.`
                : "Booking cancelled successfully. No charges applied.",
            cancellationLeft: maxLimit - appt.cancellationCount,
            data: {
                cancellationFee: policyResult.cancellationFee,
                refundAmount: policyResult.refundAmount,
                booking: appt
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. RESCHEDULE BED BOOKING (Strict Global Limits Integration - No Conflicts) ---
const rescheduleBedBooking = async (req, res) => {
    try {
        const { appointmentId, newStartDate, newEndDate, newBedId } = req.body;

        const appt = await Appointment.findById(appointmentId);
        if (!appt) return res.status(404).json({ success: false, message: "Booking not found." });

        // FIX: Fetch platform-wide limit from dynamic global model (Fallback is 2)
        const globalConfig = await BedRescheduleLimit.findOne();
        const maxLimit = globalConfig ? globalConfig.maxLimit : 2;

        const currentRescheduleCount = appt.rescheduleCount || 0;

        // Validation against Global Limit
        if (currentRescheduleCount >= maxLimit) {
            return res.status(400).json({ 
                success: false, 
                message: `Reschedule failed: Aapki maximum reschedule limit (${maxLimit} times) poori ho chuki hai.` 
            });
        }

        const originalStart = moment(appt.startDate).startOf('day');
        const originalEnd = moment(appt.endDate).startOf('day');
        const originalDuration = originalEnd.diff(originalStart, 'days');

        const start = moment(newStartDate).startOf('day').toDate();
        const end = moment(newEndDate).endOf('day').toDate();

        const newStartMoment = moment(newStartDate).startOf('day');
        const newEndMoment = moment(newEndDate).startOf('day');
        const newDuration = newEndMoment.diff(newStartMoment, 'days');

        if (originalDuration !== newDuration) {
            return res.status(400).json({
                success: false,
                message: `Reschedule failed: Aapki original booking ${originalDuration} din ki thi. Naye schedule me bhi strictly ${originalDuration} din select karein.`
            });
        }

        const targetBedId = newBedId || appt.bedId;
        const isOccupied = await Appointment.findOne({
            _id: { $ne: appointmentId },
            bedId: targetBedId,
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] },
            $and: [
                { startDate: { $lte: end } },
                { endDate: { $gte: start } }
            ]
        });

        if (isOccupied) {
            return res.status(400).json({ 
                success: false, 
                message: "Selected bed naye target dates ke liye pehle se hi occupied hai. Kripya naya date range ya bed choose karein." 
            });
        }

        appt.startDate = start;
        appt.endDate = end;
        if (newBedId) {
            appt.bedId = newBedId;
            const bed = await Bed.findById(newBedId);
            appt.bedNumber = bed ? bed.bedNumber : appt.bedNumber;
        }
        
        appt.rescheduleCount = currentRescheduleCount + 1;
        appt.status = 'Hospital-Pending'; 

        await appt.save();
        res.json({ success: true, message: "Admission rescheduled successfully", data: appt });

    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};




const getBedMonthlySchedule = async (req, res) => {
    try {
        const { bedId, month, year } = req.query;

        if (!bedId) {
            return res.status(400).json({ success: false, message: "bedId is required." });
        }

        // Agar month ya year nahi bheja, toh current month/year select hoga
        const targetMonth = month ? parseInt(month) : moment().month() + 1; // 1-indexed (1-12)
        const targetYear = year ? parseInt(year) : moment().year();

        const bed = await Bed.findById(bedId);
        if (!bed) return res.status(404).json({ success: false, message: "Bed not found" });

        // Select kiye gaye month ka start aur end date range nikalenge
        const startOfMonth = moment([targetYear, targetMonth - 1]).startOf('month');
        const endOfMonth = moment([targetYear, targetMonth - 1]).endOf('month');

        const totalDays = endOfMonth.date(); // Us month me total kitne din hain (e.g. 30 ya 31)

        // Find active overlapping bookings strictly for this bed inside this month
        const bookings = await Appointment.find({
            bedId,
            bookingType: 'Admission',
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] },
            $and: [
                { startDate: { $lte: endOfMonth.toDate() } },
                { endDate: { $gte: startOfMonth.toDate() } }
            ]
        }).populate('userId', 'name');

        const calendar = [];

        // Pooray month ke sabhi days ka loop chalayenge (1 to totalDays)
        for (let day = 1; day <= totalDays; day++) {
            const currentDay = moment([targetYear, targetMonth - 1, day]).startOf('day');
            const currentDayDate = currentDay.toDate();
            
            // Check if any booking is overlapping on this specific day
            const match = bookings.find(b => {
                const bStart = moment(b.startDate).startOf('day').toDate();
                const bEnd = moment(b.endDate).startOf('day').toDate();
                return currentDayDate >= bStart && currentDayDate <= bEnd;
            });

            let dayStatus = 'Available';
            if (match) {
                dayStatus = 'Occupied';
            } else if (bed.status === 'Maintenance') {
                dayStatus = 'Maintenance'; // Agar bed manual maintenance par lock hai
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




// 5. GET MY BOOKINGS (Screenshot 20, 21 - Upcoming, Pending, History)
// 5. GET MY BOOKINGS (Strictly mapped with your exact JSON Keys)
const getMyHospitalBookings = async (req, res) => {
    try {
        const { tab, page = 1 } = req.query; // default page 1 rahega
        const limit = 20; // 20 orders ki limit
        const skip = (parseInt(page) - 1) * limit;
        
        let query = { 
            userId: req.user.id, 
            bookingType: 'Admission' 
        };

        if (tab === 'Upcoming') {
            query.status = 'Confirmed';
        } else if (tab === 'Pending') {
            query.status = { $in: ['Pending', 'Hospital-Pending'] };
        } else if (tab === 'History') {
            query.status = { $in: ['Completed', 'Cancelled-By-User', 'Cancelled-By-Hospital'] };
        }

        // Total documents count nikalne ke liye
        const totalCount = await Appointment.countDocuments(query);

        // Fetch dynamic global limit set by Super Admin (default fallback is 2)
        const globalConfig = await BedRescheduleLimit.findOne();
        const maxLimit = globalConfig ? globalConfig.maxLimit : 2;

        const data = await Appointment.find(query)
            .populate('hospitalId', 'name address hospitalImage')
            .populate('doctorId', 'name speciality profileImage')
            .populate({
                path: 'bedId',
                select: 'bedNumber status pricePerDay isVentilatorAvailable wardId',
                populate: {
                    path: 'wardId',
                    select: 'name type'
                }
            })
            .sort({ createdAt: -1 }) 
            .skip(skip)
            .limit(limit);

        // Returning exact old structure with ONLY one extra key "maxRescheduleLimit"
        res.json({ 
            success: true, 
            count: data.length,
            maxRescheduleLimit: maxLimit,   // 👈 Purely added as an extra key at root
            pagination: {
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
                currentPage: parseInt(page),
                limit
            },
            data 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
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


// --- POST: RATE COMPLETED HOSPITAL BED ADMISSION ---
// POST /user/hospital/rate
const rateHospitalAdmission = async (req, res) => {
    try {
        const { bookingId, rating, comment } = req.body;

        // 1. Pehle confirm karein ki user ki admission booking completed hai ya nahi
        const booking = await Appointment.findOne({ 
            _id: bookingId, 
            userId: req.user.id, 
            bookingType: 'Admission' 
        });

        if (!booking || booking.status !== 'Completed') {
            return res.status(400).json({ success: false, message: "You can only rate completed hospital bed bookings/admissions." });
        }

        // 2. Check karein ki user pehle se is booking ko rate toh nahi kar chuka (duplicate review protection)
        const existingReview = await Review.findOne({ userId: req.user.id, orderId: bookingId });
        if (existingReview) {
            return res.status(400).json({ success: false, message: "You have already submitted a review for this hospital admission." });
        }

        // 3. Create Polymorphic Review for Hospital
        await Review.create({
            userId: req.user.id,
            userName: req.user.name || "Verified User",
            targetId: booking.hospitalId, // Hospital ID
            targetType: 'Hospital',       // Polymorphic tag pointing to Hospital model
            orderId: bookingId,
            rating,
            comment: comment || ""
        });

        // 4. Dynamic Aggregation: Live average recalculate karein
        const stats = await Review.aggregate([
            { $match: { targetId: booking.hospitalId, targetType: 'Hospital' } },
            { $group: { _id: null, averageRating: { $avg: "$rating" }, totalReviews: { $sum: 1 } } }
        ]);

        if (stats.length > 0) {
            const newRating = Number(stats[0].averageRating.toFixed(1));
            const totalReviews = stats[0].totalReviews;

            // Cache updated metrics inside Hospital document for fast reads
            await Hospital.findByIdAndUpdate(booking.hospitalId, {
                rating: newRating,
                totalReviews: totalReviews
            });
        }

        res.json({ success: true, message: "Thank you for rating your hospital stay experience!" });

    } catch (error) {
        console.error("Rate Hospital Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};



module.exports = {
    getHospitals, getWards, getBedGrid, getDoctorsByHospitalId, getServicesByHospitalId, getHospitalCoupons, validateHospitalCoupon,
    getAvailableBedsForRange,cancelBedBooking, rescheduleBedBooking, getBedMonthlySchedule, rateHospitalAdmission,
    getHospitalCheckoutSummary, finalHospitalBooking,verifyHospitalPayment, getMyHospitalBookings, getBookingProfiles,
    getHospitalDetails, addReview, updateReview
};