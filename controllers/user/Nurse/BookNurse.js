const Nurse = require('../../../models/Nurse');
const NurseBooking = require('../../../models/NurseBooking');
const Hospital = require('../../../models/Hospital'); 
const NurseService = require('../../../models/NurseService');
const NursePackage = require('../../../models/NursePackage');
const Availability = require('../../../models/Availability');
const DeliveryCharge = require('../../../models/DeliveryCharge');
const CareService = require('../../../models/CareService');
const MasterConsumable = require('../../../models/MasterConsumable');
const { isNurseAvailable, generateNurseSlots } = require('../../../utils/timeSlotHelper');
const NurseConsumable = require('../../../models/MasterConsumable');
const Coupon = require('../../../models/Coupon');
const Review = require('../../../models/Review');
const UserSubscription = require('../../../models/UserSubscription');
const { getDistance } = require('../../../utils/helpers');
const mongoose = require('mongoose');
const moment = require('moment');
const crypto = require('crypto');

const { createRazorpayOrder, verifyRazorpaySignature, fetchAndMapRazorpayPayment } = require('../../../utils/razorpay'); // 👈 Razorpay Helpers Imported
const { sendPushNotification, notifyAdminsAndVendor } = require('../../../utils/notification'); // For Notifications
const { checkAndApplyBenefit, deductBenefitCount, refundBenefitCount } = require('../../../utils/subscriptionBenefitHelper');
const { processCancellationRefund } = require('../../../utils/policyHelper');
const { isCodEnabled } = require('../../../utils/policyHelper');

// Helper function to safely escape regex special characters
const escapeRegex = (string) => {
    if (!string || typeof string !== 'string') return '';
    return string.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
};



// 1. LIST NURSES
const getNurses = async (req, res) => {
    try {
        const { city, search, speciality } = req.body;

        // Strictly filters: Only APPROVED and ACTIVE (isActive: true) nurses
        let query = { profileStatus: 'Approved', isActive: true };

        if (city) query.city = new RegExp(city, 'i');
        if (search) query.name = new RegExp(search, 'i');
        if (speciality) query.speciality = speciality;

        const nurses = await Nurse.find(query).lean();
        console.log(`Found ${nurses.length} approved nurses in DB`);

        const data = [];

        for (let nurse of nurses) {
            const services = await NurseService.find({ nurseId: nurse._id });
            console.log(`Nurse ${nurse.name} has ${services.length} services`);

            let minPrice = 0;
            let serviceTitles = [];

            if (services.length > 0) {
                const validPrices = services
                    .map(s => (s.pricing && s.pricing.oneDay ? s.pricing.oneDay.final : 0))
                    .filter(p => p > 0);

                minPrice = validPrices.length > 0 ? Math.min(...validPrices) : 0;
                serviceTitles = services.slice(0, 2).map(s => s.title);
            }

            // Projecting 'isOnline' in list response
            data.push({
                _id: nurse._id,
                name: nurse.name,
                profileImage: nurse.profileImage,
                rating: nurse.rating || 0,
                city: nurse.city,
                experienceYears: nurse.experienceYears || 0,
                startingPrice: minPrice || 0,
                topServices: serviceTitles,
                location: nurse.location,
                profileStatus: nurse.profileStatus,
                isOnline: nurse.isOnline ?? true // Passes isOnline state to frontend
            });
        }

        res.json({ success: true, count: data.length, data });

    } catch (error) {
        console.error("getNurses Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get Detailed Nurse Bureau Profile with Services, Packages & Reviews
// @route   GET /user/nurse/details/:id
// @access  Public / User
const getNurseDetails = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: "Invalid Nurse Bureau ID format." });
        }

        // 1. Fetch Nurse Bureau Profile
        const nurse = await Nurse.findById(id).select('-password -token').lean();
        if (!nurse || nurse.isActive === false) {
            return res.status(404).json({ success: false, message: "Nurse Bureau not found or account is inactive." });
        }

        // 2. Fetch Active Services, Packages, and Reviews in parallel
        const [services, packages, reviews] = await Promise.all([
            NurseService.find({ nurseId: id, status: 'Approved' })
                .populate('consumablesUsed.masterItemId', 'itemName size mrp unitType')
                .lean(),
            NursePackage.find({ nurseId: id, status: 'Approved' })
                .populate('includedServices', 'category subCategory description procedureIncluded')
                .populate('consumablesUsed.masterItemId', 'itemName size mrp unitType')
                .lean(),
            Review.find({ targetId: id, targetType: 'Nurse' })
                .sort({ createdAt: -1 })
                .limit(10)
                .lean()
        ]);

        return res.status(200).json({
            success: true,
            data: {
                nurse: {
                    ...nurse,
                    rating: nurse.rating || 4.8,
                    totalReviews: nurse.totalReviews || reviews.length || 0
                },
                services: services || [],
                packages: packages || [],
                reviews: reviews || []
            }
        });

    } catch (error) {
        console.error("getNurseDetails Error:", error);
        return res.status(500).json({ success: false, message: error.message || "Internal Server Error in fetching nurse details." });
    }
};

// 3. ENHANCED SEARCH SUGGESTIONS (Searches Provider Name, Master Services & Subcategories)
// endpoint: GET /user/nurse/search-suggestions?query=...
const searchNursesAndServices = async (req, res) => {
    try {
        const { query } = req.query;
        if (!query || query.trim().length < 2) {
            return res.json({ success: true, count: 0, data: [] });
        }

        const safeSearch = escapeRegex(query.trim());
        const regex = new RegExp(safeSearch, 'i');

        // Parallel Lookups: 1. Providers, 2. Master CSV Services, 3. Vendor Listed Services
        const [nurses, masterServices, vendorServices] = await Promise.all([
            Nurse.find({
                name: regex,
                isActive: true,
                profileStatus: 'Approved'
            }).select('_id name city speciality profileImage rating').limit(5).lean(),

            CareService.find({
                $or: [
                    { category: regex },
                    { subCategory: regex },
                    { servicesOffered: regex }
                ]
            }).select('_id category subCategory oneDayOneTimePrice pricePerHour').limit(8).lean(),

            NurseService.find({
                title: regex,
                status: 'Approved'
            }).populate('nurseId', 'name profileImage city rating isActive profileStatus').limit(5).lean()
        ]);

        const suggestions = [];

        // 1. Map Master Services (CSV Uploads)
        masterServices.forEach(ms => {
            suggestions.push({
                id: ms._id,
                type: "Service",
                title: ms.subCategory,
                subtitle: `Category: ${ms.category}`,
                startingPrice: ms.oneDayOneTimePrice || ms.pricePerHour || 0,
                category: ms.category,
                subCategory: ms.subCategory,
                image: null
            });
        });

        // 2. Map Nurse Providers
        nurses.forEach(n => {
            suggestions.push({
                id: n._id,
                type: "Provider",
                title: n.name,
                subtitle: `${n.speciality || 'General Nursing'} • ${n.city || ''}`,
                startingPrice: null,
                category: null,
                subCategory: null,
                image: n.profileImage || null
            });
        });

        // 3. Map Specific Vendor Services
        vendorServices.forEach(vs => {
            if (vs.nurseId && vs.nurseId.isActive !== false && vs.nurseId.profileStatus === 'Approved') {
                suggestions.push({
                    id: vs._id,
                    type: "VendorService",
                    title: vs.title,
                    subtitle: `Provided by: ${vs.nurseId.name} (${vs.nurseId.city || ''})`,
                    startingPrice: vs.pricing?.oneDay?.final || vs.pricing?.hourly?.final || 0,
                    category: null,
                    subCategory: vs.title,
                    image: vs.nurseId.profileImage || null
                });
            }
        });

        res.json({
            success: true,
            count: suggestions.length,
            data: suggestions
        });

    } catch (error) {
        console.error("Search Nurse Suggestions Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};



const getNurseDeliveryConfig = async (req, res) => {
    try {
        const { nurseId } = req.params;

        // 1. Database se check karo
        let config = await DeliveryCharge.findOne({ vendorId: nurseId });

        // 2. Fallback logic: Agar config nahi mili, to default values return karo
        if (!config) {
            return res.json({
                success: true,
                message: "Using default delivery configuration",
                data: {
                    vendorId: nurseId,
                    vendorType: 'Nurse',
                    fixedPrice: 50,
                    fixedDistance: 5,
                    pricePerKM: 5,
                    fastDeliveryExtra: 69,
                    freeDeliveryThreshold: 500,
                    taxPercentage: 0,
                    taxInRupees: 0,
                    isDefault: true // Frontend ko batane ke liye
                }
            });
        }

        // 3. Agar mili, to as it is return karo
        res.json({
            success: true,
            data: config
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



const checkRangeAvailability = async (req, res) => {
    try {
        const { nurseId, startDate, endDate } = req.query;

        if (!startDate || !endDate) return res.status(400).json({ message: "Start and End date required" });

        const reqStart = moment(startDate).startOf('day');
        const reqEnd = moment(endDate).endOf('day');

        // Check if ANY booking exists between these two dates
        const conflictingBookings = await NurseBooking.find({
            nurseId,
            status: { $in: ['Confirmed', 'Assigned', 'On-The-Way', 'Arrived', 'Service-Started'] },
            $or: [
                {
                    "schedule.startDate": { $lte: reqEnd.toDate() },
                    "schedule.endDate": { $gte: reqStart.toDate() }
                }
            ]
        });

        if (conflictingBookings.length > 0) {
            // Hum un dates ki list bhej sakte hain jo already booked hain
            const busyDates = conflictingBookings.map(b => ({
                from: moment(b.schedule.startDate).format('YYYY-MM-DD'),
                to: moment(b.schedule.endDate).format('YYYY-MM-DD'),
                type: b.schedule.duration
            }));

            return res.json({
                success: false,
                isAvailable: false,
                message: "Nurse is busy on some days within this range",
                busyDates
            });
        }

        res.json({ success: true, isAvailable: true, message: "Nurse is available for the entire range" });

    } catch (error) { res.status(500).json({ message: error.message }); }
};
// =========================================================================
// 📅 GET NURSE AVAILABILITY (CALENDAR DATES & MULTI-DAY PRICING SYNC)
// Endpoint: GET /user/nurse/availability/:nurseId
// =========================================================================
const getNurseAvailability = async (req, res) => {
    try {
        const { nurseId } = req.params;
        const { serviceId, packageId, isPackage, type = 'One day One Time' } = req.query;

        // 1. Fetch Target Service or Package
        let targetItem = null;
        if (isPackage === 'true' || isPackage === true || packageId) {
            targetItem = await NursePackage.findById(packageId || serviceId).lean();
        } else if (serviceId) {
            targetItem = await NurseService.findById(serviceId).lean();
        }

        // Base price extraction
        const baseOneDayPrice = targetItem?.pricing?.oneDay?.final || 1800;
        const baseMultiDayPrice = targetItem?.pricing?.multipleDays?.final || baseOneDayPrice;
        const baseHourlyPrice = targetItem?.pricing?.hourly?.final || 200;

        // 2. Fetch Bureau Availability Settings
        let availability = await Availability.findOne({ vendorId: nurseId }).lean();
        if (!availability) {
            availability = {
                startTime: "08:00",
                endTime: "20:00",
                slotDuration: 60,
                premiumDates: [],
                premiumSlots: [],
                unavailableSlots: []
            };
        }

        const premiumDatesList = availability.premiumDates || [];
        const premiumSlotsList = availability.premiumSlots || [];
        const unavailableSlots = availability.unavailableSlots || [];

        // 3. Generate 30-Day Calendar with exact mode-based pricing
        const calendar = [];
        const today = moment();

        for (let i = 0; i < 30; i++) {
            const dateMoment = today.clone().add(i, 'days');
            const dateStr = dateMoment.format('YYYY-MM-DD');

            const matchedPremiumDate = premiumDatesList.find(p => p.date === dateStr);
            const isPremium = !!matchedPremiumDate && Number(matchedPremiumDate.extraFee || 0) > 0;
            const extraFee = isPremium ? Number(matchedPremiumDate.extraFee) : 0;

            calendar.push({
                date: dateStr,
                dayName: dateMoment.format('ddd'),
                dayNumber: dateMoment.date(),
                isDisabled: false,
                pricing: {
                    isPremium,
                    extraFee,
                    oneDayPrice: baseOneDayPrice + extraFee,
                    multipleDayPrice: baseMultiDayPrice + extraFee, // 👈 Exact Multiple Days Rate
                    hourlyPrice: baseHourlyPrice
                }
            });
        }

        // 4. Generate Time Slots Grid
        const timeSlots = [];
        const startHour = moment(availability.startTime || "08:00", "HH:mm");
        const endHour = moment(availability.endTime || "20:00", "HH:mm");
        const slotStep = availability.slotDuration || 60;

        let currentSlot = startHour.clone();
        while (currentSlot.isBefore(endHour)) {
            const slotTime24 = currentSlot.format("HH:mm");
            const isBlocked = unavailableSlots.includes(slotTime24);

            if (!isBlocked) {
                const matchedPremiumSlot = premiumSlotsList.find(s => s.time === slotTime24);
                const isPremiumSlot = !!matchedPremiumSlot && Number(matchedPremiumSlot.extraFee || 0) > 0;
                const slotExtraFee = isPremiumSlot ? Number(matchedPremiumSlot.extraFee) : 0;

                timeSlots.push({
                    time: slotTime24,
                    displayTime: currentSlot.format("hh:mm A"),
                    slotPremiumFee: slotExtraFee,
                    hourlyBasePrice: baseHourlyPrice,
                    totalHourlyPrice: baseHourlyPrice + slotExtraFee,
                    isAvailable: true
                });
            }
            currentSlot.add(slotStep, 'minutes');
        }

        res.status(200).json({
            success: true,
            data: {
                calendar,
                timeSlots,
                baseRates: {
                    oneDay: baseOneDayPrice,
                    multipleDays: baseMultiDayPrice,
                    hourly: baseHourlyPrice
                }
            }
        });

    } catch (error) {
        console.error("Get Nurse Availability Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 1. GET COUPONS FOR A SPECIFIC NURSE
const getAvailableCoupons = async (req, res) => {
    try {
        const nurseId = req.params.id; // Corrected param key fromreq.params.id

        // Root level checks: Strictly filter only 'Nurse' and 'All' coupon types
        let query = {
            isActive: true,
            expiryDate: { $gte: new Date() },
            vendorType: { $in: ['Nurse', 'All'] }
        };

        if (nurseId && mongoose.Types.ObjectId.isValid(nurseId)) {
            query.$or = [
                { isAdminCreated: true },
                { vendorId: nurseId }
            ];
        } else {
            query.isAdminCreated = true;
        }

        const coupons = await Coupon.find(query).select('couponName discountPercentage maxDiscount minOrderAmount expiryDate description');
        res.json({ success: true, count: coupons.length, data: coupons });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
// 2. VALIDATE COUPON (Manual Check)
const validateCoupon = async (req, res) => {
    try {
        const { couponCode, nurseId, totalAmount } = req.body;
        const userId = req.user.id;

        if (!couponCode) {
            return res.status(400).json({ success: false, message: "Coupon code is required" });
        }

        let query = {
            couponName: couponCode.toUpperCase(),
            isActive: true,
            expiryDate: { $gte: new Date() },
            vendorType: { $in: ['Nurse', 'All'] } // Root level strictly matching Nurse Bureau
        };

        if (nurseId && mongoose.Types.ObjectId.isValid(nurseId)) {
            query.$or = [
                { isAdminCreated: true },
                { vendorId: nurseId }
            ];
        } else {
            query.isAdminCreated = true;
        }

        const coupon = await Coupon.findOne(query);
        if (!coupon) {
            return res.status(404).json({ success: false, message: "Invalid or Expired Coupon Code for Nursing Service" });
        }

        if (totalAmount < coupon.minOrderAmount) {
            return res.status(400).json({ success: false, message: `Minimum order amount for this coupon is ₹${coupon.minOrderAmount}` });
        }

        const userUsage = coupon.usedBy.find(u => u.userId.toString() === userId.toString());
        const usageCount = userUsage ? userUsage.usageCount : 0;

        if (usageCount >= coupon.maxUsagePerUser) {
            return res.status(400).json({ success: false, message: "You have already reached the maximum usage limit for this coupon" });
        }

        let discountAmount = (totalAmount * coupon.discountPercentage) / 100;
        if (discountAmount > coupon.maxDiscount) {
            discountAmount = coupon.maxDiscount;
        }

        res.json({
            success: true,
            message: "Coupon Applied Successfully!",
            data: {
                couponId: coupon._id,
                couponName: coupon.couponName,
                discountPercentage: coupon.discountPercentage,
                discountAmount: Math.round(discountAmount),
                finalPayable: Math.round(totalAmount - discountAmount)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 1. GET REGISTERED HK HOSPITALS (For Hospital Selection Dropdown in Nurse Booking)
// endpoint: GET /user/nurse/hospitals/dropdown?search=...&city=...
const getRegisteredHospitalsDropdown = async (req, res) => {
    try {
        const { search, city } = req.query;

        let query = { profileStatus: 'Approved', isActive: true };

        if (city && city.trim() !== '') {
            query.city = { $regex: new RegExp("^" + escapeRegex(city.trim()) + "$", "i") };
        }

        if (search && search.trim() !== '') {
            const cleanSearch = escapeRegex(search.trim());
            query.$or = [
                { name: { $regex: cleanSearch, $options: 'i' } },
                { address: { $regex: cleanSearch, $options: 'i' } },
                { city: { $regex: cleanSearch, $options: 'i' } }
            ];
        }

        const hospitals = await Hospital.find(query)
            .select('name address city state type hospitalImage location')
            .sort({ name: 1 })
            .limit(30)
            .lean();

        res.status(200).json({
            success: true,
            count: hospitals.length,
            data: hospitals.map(h => ({
                _id: h._id,
                name: h.name,
                address: h.address || "",
                city: h.city || "",
                state: h.state || "",
                type: h.type || "Private",
                location: h.location || { lat: 0, lng: 0 },
                image: h.hospitalImage && h.hospitalImage.length > 0 ? h.hospitalImage[0] : null
            }))
        });

    } catch (error) {
        console.error("Get Registered Hospitals Dropdown Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🧮 HELPER: CALCULATE PRICING (MULTI-HOUR & 1ST-HOUR PEAK SURCHARGE RULE)
// =========================================================================
const calculateNurseBookingBreakdown = async ({
    nurseId,
    serviceId,
    packageId,
    isPackage,
    selectedType,
    startDate,
    endDate,
    startTime,
    endTime,
    isFasterService,
    patientCount = 1,
    selectedConsumables = [],
    couponCode = null,
    userId = null
}) => {
    // 1. Fetch Target Service / Package
    let targetItem = null;
    if (isPackage || packageId) {
        targetItem = await NursePackage.findById(packageId || serviceId).lean();
    } else {
        targetItem = await NurseService.findById(serviceId).lean();
    }

    if (!targetItem) {
        throw new Error("Selected Nurse Service or Package not found.");
    }

    // 2. Base Price Calculation depending on duration type
    let unitBaseFee = 0;
    let stayDays = 1;
    let totalHours = 1;

    if (selectedType === 'For Multiple Days') {
        const startM = moment(startDate).startOf('day');
        const endM = moment(endDate || startDate).startOf('day');
        stayDays = Math.max(1, endM.diff(startM, 'days') + 1);
        
        // Use Multiple Days per-day rate
        const perDayRate = targetItem.pricing?.multipleDays?.final || targetItem.pricing?.oneDay?.final || 0;
        unitBaseFee = perDayRate * stayDays;

    } else if (selectedType === 'Acc. To Per/Hours') {
        if (startTime && endTime) {
            const sTime = moment(startTime, ["HH:mm", "hh:mm A"]);
            const eTime = moment(endTime, ["HH:mm", "hh:mm A"]);
            const durationMinutes = eTime.diff(sTime, 'minutes');
            totalHours = Math.max(1, Math.round(durationMinutes / 60));
        }
        // Base rate is multiplied across all chosen hours
        const hourlyRate = targetItem.pricing?.hourly?.final || 0;
        unitBaseFee = hourlyRate * totalHours;

    } else {
        // 'One day One Time' default
        unitBaseFee = targetItem.pricing?.oneDay?.final || 0;
    }

    const patients = Number(patientCount) || 1;
    const baseServicePrice = Math.round(unitBaseFee * patients);

    // 3. Dynamic Premium Surcharge Evaluation
    let datePremiumFee = 0;
    let slotPremiumFee = 0;

    const availabilityConfig = await Availability.findOne({ vendorId: nurseId }).lean();

    if (availabilityConfig) {
        // A. DATE PREMIUM: Checked ONLY on Start Date / First Day (even in Multi-Day)
        const startDateFormatted = moment(startDate).format('YYYY-MM-DD');
        if (availabilityConfig.premiumDates && Array.isArray(availabilityConfig.premiumDates)) {
            const matchedDate = availabilityConfig.premiumDates.find(p => p.date === startDateFormatted);
            if (matchedDate && Number(matchedDate.extraFee || 0) > 0) {
                datePremiumFee = Number(matchedDate.extraFee);
            }
        }

        // B. TIME SLOT PREMIUM: Checked ONLY for 1st hour / Start Slot (Not repeated for remaining hours)
        if (startTime) {
            const startSlotFormatted = moment(startTime, ["HH:mm", "hh:mm A"]).format('HH:mm');
            if (availabilityConfig.premiumSlots && Array.isArray(availabilityConfig.premiumSlots)) {
                const matchedSlot = availabilityConfig.premiumSlots.find(s => s.time === startSlotFormatted);
                if (matchedSlot && Number(matchedSlot.extraFee || 0) > 0) {
                    slotPremiumFee = Number(matchedSlot.extraFee);
                }
            }
        }
    }

    // Total Surcharge = Date Premium (Day 1) + Slot Premium (Hour 1)
    const slotSurcharge = datePremiumFee + slotPremiumFee;

    // 4. Consumables Calculation
    let consumableTotal = 0;
    if (selectedConsumables && Array.isArray(selectedConsumables)) {
        selectedConsumables.forEach(c => {
            const itemPrice = Number(c.price || c.finalPrice || 0);
            consumableTotal += itemPrice;
        });
    }

    // 5. Faster / Express Delivery Charge
    let fasterServiceCharge = 0;
    if (isFasterService === true || isFasterService === 'true') {
        const deliveryChargeConfig = await DeliveryCharge.findOne({ vendorId: nurseId }).lean();
        fasterServiceCharge = Number(deliveryChargeConfig?.fastDeliveryExtra || 100);
    }

    // 6. Subtotal & Coupon Discount
    const subtotal = baseServicePrice + slotSurcharge + consumableTotal + fasterServiceCharge;

    let couponDiscount = 0;
    let appliedCouponObj = null;

    if (couponCode) {
        const coupon = await Coupon.findOne({
            couponName: String(couponCode).toUpperCase().trim(),
            isActive: true,
            expiryDate: { $gte: new Date() }
        }).lean();

        if (coupon && subtotal >= (coupon.minOrderAmount || 0)) {
            const isVendorMatch = !coupon.vendorId || String(coupon.vendorId) === String(nurseId);
            const isTypeMatch = coupon.vendorType === 'All' || coupon.vendorType === 'Nurse';

            if (isVendorMatch && isTypeMatch) {
                let disc = (subtotal * coupon.discountPercentage) / 100;
                if (disc > coupon.maxDiscount) disc = coupon.maxDiscount;
                couponDiscount = Math.round(disc);
                appliedCouponObj = {
                    couponId: coupon._id,
                    couponName: coupon.couponName,
                    discountAmount: couponDiscount
                };
            }
        }
    }

    // 7. Subscription Benefit Integration
    let finalBaseServicePrice = baseServicePrice;
    let isSubscriptionApplied = false;

    if (userId) {
        const benefitCheck = await checkAndApplyBenefit(userId, 'freeNurseVisitsCount', baseServicePrice);
        if (benefitCheck.isApplied) {
            finalBaseServicePrice = 0;
            isSubscriptionApplied = true;
        }
    }

    const calculatedSubtotal = finalBaseServicePrice + slotSurcharge + consumableTotal + fasterServiceCharge;
    const finalTotalPrice = Math.max(0, Math.round(calculatedSubtotal - couponDiscount));

    return {
        targetItem,
        breakdown: {
            baseServicePrice: finalBaseServicePrice,
            originalBasePrice: baseServicePrice,
            pCount: patients,
            totalDays: stayDays,
            totalHours: totalHours,
            datePremiumFee,
            slotPremiumFee,
            slotSurcharge,
            consumableTotal,
            fasterServiceCharge,
            couponDiscount,
            taxAmount: 0,
            totalPrice: finalTotalPrice,
            appliedCoupon: appliedCouponObj,
            isSubscriptionApplied
        }
    };
};

// =========================================================================
// 1. CHECKOUT SUMMARY API
// Endpoint: POST /user/nurse/checkout
// =========================================================================
const checkoutNurseBooking = async (req, res) => {
    try {
        const {
            nurseId,
            serviceId,
            packageId,
            isPackage,
            selectedType,
            startDate,
            endDate,
            startTime,
            endTime,
            isFasterService,
            patientCount,
            selectedConsumables,
            couponCode
        } = req.body;

        const userId = req.user ? req.user.id : null;

        if (!nurseId || (!serviceId && !packageId)) {
            return res.status(400).json({ 
                success: false, 
                message: "nurseId and serviceId/packageId are required." 
            });
        }

        const { breakdown } = await calculateNurseBookingBreakdown({
            nurseId,
            serviceId,
            packageId,
            isPackage: isPackage === true || isPackage === 'true',
            selectedType: selectedType || 'One day One Time',
            startDate,
            endDate,
            startTime,
            endTime,
            isFasterService,
            patientCount,
            selectedConsumables,
            couponCode,
            userId
        });

        // Check COD status for user
        const isCodAvailable = await isCodEnabled('Nurse', userId);

        res.status(200).json({
            success: true,
            message: "Nurse checkout calculation completed.",
            isCodAvailable,
            breakdown
        });

    } catch (error) {
        console.error("Checkout Nurse Booking Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 2. PLACE NURSE BOOKING API
// Endpoint: POST /user/nurse/book
// =========================================================================
const placeNurseBooking = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            nurseId,
            serviceId,
            packageId,
            isPackage,
            schedule,
            patients = [],
            address,
            assessmentLocation = 'At Home',
            selectedConsumables = [],
            isFasterService = false,
            couponCode,
            paymentMethod = 'Online',
            healthDetails,
            hospitalDetails
        } = req.body;

        if (!nurseId || (!serviceId && !packageId) || !schedule || !address) {
            return res.status(400).json({
                success: false,
                message: "Missing required booking details (nurseId, serviceId/packageId, schedule, address)."
            });
        }

        // 1. Calculate price breakdown with active surcharges
        const { targetItem, breakdown } = await calculateNurseBookingBreakdown({
            nurseId,
            serviceId,
            packageId,
            isPackage: isPackage === true || isPackage === 'true',
            selectedType: schedule.duration || 'One day One Time',
            startDate: schedule.startDate,
            endDate: schedule.endDate,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
            isFasterService,
            patientCount: (patients && patients.length > 0) ? patients.length : 1,
            selectedConsumables,
            couponCode,
            userId
        });

        const totalPayable = breakdown.totalPrice;
        const bookingId = `HKN-${Date.now().toString().slice(-6)}${Math.floor(100 + Math.random() * 900)}`;

        // OTPs for visit start & complete
        const startOtp = Math.floor(1000 + Math.random() * 9000).toString();
        const endOtp = Math.floor(1000 + Math.random() * 9000).toString();

        // 2. Build Booking Object
        const newBooking = new NurseBooking({
            userId,
            nurseId,
            serviceId: !isPackage ? (serviceId || targetItem._id) : null,
            packageId: isPackage ? (packageId || targetItem._id) : null,
            bookingId,
            bookingType: 'Regular',
            serviceDetails: {
                title: targetItem.title || targetItem.packageName || "Nursing Care",
                type: targetItem.type || (isPackage ? "Package" : "Daily Care"),
                duration: schedule.duration,
                basePrice: targetItem.pricing?.oneDay?.final || 0,
                procedureIncluded: targetItem.procedureIncluded || "",
                servicesOffered: targetItem.servicesOffered || ""
            },
            priceBreakdown: {
                baseServicePrice: breakdown.baseServicePrice,
                originalBasePrice: breakdown.originalBasePrice,
                slotSurcharge: breakdown.slotSurcharge,
                consumableTotal: breakdown.consumableTotal,
                couponDiscount: breakdown.couponDiscount,
                fasterServiceCharge: breakdown.fasterServiceCharge,
                taxAmount: breakdown.taxAmount || 0,
                totalPrice: totalPayable
            },
            couponCode: couponCode ? String(couponCode).toUpperCase() : null,
            appliedCoupon: breakdown.appliedCoupon,
            patients: Array.isArray(patients) && patients.length > 0 ? patients : [{
                patientId: 'Self',
                name: req.user.name || "Self",
                relation: 'Self'
            }],
            assessmentLocation,
            healthDetails: healthDetails || {},
            hospitalDetails: assessmentLocation === 'At Hospital' ? hospitalDetails : undefined,
            schedule: {
                startDate: schedule.startDate ? new Date(schedule.startDate) : new Date(),
                endDate: schedule.endDate ? new Date(schedule.endDate) : (schedule.startDate ? new Date(schedule.startDate) : new Date()),
                startTime: schedule.startTime || "09:00",
                endTime: schedule.endTime || null,
                duration: schedule.duration || 'One day One Time'
            },
            address,
            selectedConsumables: selectedConsumables.map(c => ({
                consumableId: c.consumableId || c._id,
                itemName: c.itemName || c.name || "Consumable",
                price: Number(c.price || c.finalPrice || 0),
                unitType: c.unitType || "Piece"
            })),
            status: 'Pending',
            paymentMethod,
            paymentStatus: (paymentMethod === 'COD' || totalPayable === 0) ? 'Pending' : 'Pending',
            serviceOTP: startOtp,
            completionOTP: endOtp
        });

        // 3. Handle COD or 100% Free Bookings
        if (paymentMethod === 'COD' || totalPayable === 0) {
            newBooking.status = 'Pending';
            if (totalPayable === 0) {
                newBooking.paymentStatus = 'Paid';
            }
            await newBooking.save();

            if (breakdown.isSubscriptionApplied) {
                await deductBenefitCount(userId, 'freeNurseVisitsCount');
            }

            // Notify Bureau
            try {
                await sendPushNotification(
                    nurseId,
                    'nurse',
                    "📋 New Nursing Booking Request!",
                    `New booking #${bookingId} has been placed. Please accept and assign staff nurse.`,
                    { bookingId: newBooking._id.toString(), type: 'new_nurse_booking' }
                );
            } catch (e) {}

            return res.status(201).json({
                success: true,
                message: "Nursing booking placed successfully!",
                bookingId,
                data: newBooking
            });
        }

        // 4. Online Payment: Create Razorpay Order
        const rzpOrder = await createRazorpayOrder(totalPayable, `rcpt_${bookingId}`);
        await newBooking.save();

        res.status(201).json({
            success: true,
            message: "Razorpay order created successfully.",
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount,
            razorpayOrderId: rzpOrder.id,
            bookingId,
            appointmentId: newBooking._id
        });

    } catch (error) {
        console.error("Place Nurse Booking Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Verify Razorpay Payment Signature for Nurse Booking & Confirm Order
// @route   POST /user/nurse/verify-payment
// @access  Private (User)
const verifyNursePayment = async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "User not authenticated." });
        }

        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) {}
        }
        if (body.response && typeof body.response === 'object') body = { ...body, ...body.response };
        if (body.data && typeof body.data === 'object') body = { ...body, ...body.data };

        const rzpPaymentId = body.razorpay_payment_id || body.razorpayPaymentId || body.paymentId || body.payment_id;
        const rzpOrderId = body.razorpay_order_id || body.razorpayOrderId || body.orderId || body.order_id;
        const rzpSignature = body.razorpay_signature || body.razorpaySignature || body.signature;

        const targetBookingId = body.bookingId || body.bookingMongoId || body.id || body._id;

        if (!rzpPaymentId) {
            return res.status(400).json({ 
                success: false, 
                errorStep: "MISSING_PAYMENT_ID",
                message: "Missing payment transaction ID (razorpay_payment_id / razorpayPaymentId)." 
            });
        }

        // Find Pending Booking
        const isObjectId = mongoose.isValidObjectId(targetBookingId);
        const searchConditions = [];

        if (isObjectId) searchConditions.push({ _id: new mongoose.Types.ObjectId(targetBookingId) });
        if (targetBookingId) searchConditions.push({ bookingId: String(targetBookingId).trim() });
        if (rzpOrderId) searchConditions.push({ "paymentDetails.razorpayOrderId": String(rzpOrderId).trim() });

        let booking = await NurseBooking.findOne({
            userId,
            $or: searchConditions
        });

        if (!booking) {
            booking = await NurseBooking.findOne({
                userId,
                status: 'Pending',
                paymentStatus: 'Pending'
            }).sort({ createdAt: -1 });
        }

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                errorStep: "BOOKING_NOT_FOUND",
                message: "Nurse booking record not found for verification." 
            });
        }

        // Signature Verification
        let isVerified = false;
        if (rzpOrderId && rzpSignature) {
            isVerified = verifyRazorpaySignature(rzpOrderId, rzpPaymentId, rzpSignature);
        }

        if (!isVerified && (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV)) {
            isVerified = true;
        }

        if (!isVerified && process.env.NODE_ENV === 'production') {
            booking.paymentStatus = 'Failed';
            booking.status = 'Cancelled';
            await booking.save();
            return res.status(400).json({ 
                success: false, 
                errorStep: "SIGNATURE_MISMATCH",
                message: "Payment signature verification failed." 
            });
        }

        let paymentRecord = null;
        try {
            if (rzpSignature) {
                paymentRecord = await fetchAndMapRazorpayPayment(rzpPaymentId, rzpSignature);
            }
        } catch (e) {}

        const rawGatewayMethod = (paymentRecord?.method || "Online").toLowerCase();
        let standardizedMethod = "Online";
        if (rawGatewayMethod === "upi") standardizedMethod = "UPI";
        else if (rawGatewayMethod === "card") standardizedMethod = "Card";
        else if (rawGatewayMethod === "netbanking") standardizedMethod = "Netbanking";

        if (!paymentRecord) {
            paymentRecord = {
                razorpayPaymentId: rzpPaymentId,
                razorpayOrderId: rzpOrderId || "",
                razorpaySignature: rzpSignature || "",
                method: rawGatewayMethod,
                amount: Number(booking.priceBreakdown?.totalPrice || 0),
                currency: "INR",
                status: 'captured',
                paidAt: new Date()
            };
        }

        // Update to Confirmed & Paid
        booking.status = 'Confirmed';
        booking.paymentStatus = 'Paid';
        booking.paymentMethod = standardizedMethod;
        booking.paymentDetails = paymentRecord;
        await booking.save();

        // Deduct Quotas
        if (booking.priceBreakdown?.baseServicePrice === 0) {
            await deductBenefitCount(userId, 'freeNurseVisitsCount');
        }
        if (booking.priceBreakdown?.fasterServiceCharge === 0 && booking.assessmentLocation === 'At Home') {
            await deductBenefitCount(userId, 'freeNurseDeliveriesCount');
        }

        if (booking.appliedCoupon?.couponId) {
            await Coupon.findByIdAndUpdate(booking.appliedCoupon.couponId, {
                $push: { usedBy: { userId, usageCount: 1 } }
            });
        }

        // Notify Nurse Bureau
        try {
            await notifyAdminsAndVendor(
                booking.nurseId,
                'nurse',
                "👩‍⚕️ New Paid Nursing Booking Confirmed!",
                `Booking #${booking.bookingId} for ₹${booking.priceBreakdown.totalPrice} has been confirmed. Please assign staff.`,
                { bookingId: booking._id.toString(), type: 'new_nurse_booking' }
            );
        } catch (e) {}

        return res.status(200).json({
            success: true,
            message: "Payment successfully verified and nurse booking confirmed!",
            bookingId: booking.bookingId,
            serviceOTP: booking.serviceOTP,
            data: booking
        });

    } catch (error) {
        console.error("verifyNursePayment Error:", error);
        res.status(500).json({ success: false, message: error.message || "Internal Server Error in payment verification." });
    }
};

// @desc    Retry Online Payment for a Pending Nurse Booking
// @route   POST /user/nurse/retry-payment
// @access  Private (User)
const retryNursePayment = async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        const { bookingId } = req.body;

        if (!bookingId) {
            return res.status(400).json({ success: false, message: "bookingId is required." });
        }

        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = {
            userId,
            $or: [
                { _id: isObjectId ? new mongoose.Types.ObjectId(bookingId) : new mongoose.Types.ObjectId() },
                { bookingId: String(bookingId).trim() }
            ]
        };

        const booking = await NurseBooking.findOne(query);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Nurse booking record not found." });
        }

        if (booking.paymentStatus === 'Paid' || booking.status === 'Confirmed') {
            return res.status(400).json({ success: false, message: "This booking is already paid and confirmed." });
        }

        if (booking.paymentMethod === 'COD') {
            return res.status(400).json({ success: false, message: "This is a Cash on Delivery booking." });
        }

        const totalPayable = Number(booking.priceBreakdown?.totalPrice || 0);
        if (totalPayable <= 0) {
            return res.status(400).json({ success: false, message: "Payable amount is ₹0." });
        }

        const receiptId = `rcpt_retry_${booking.bookingId}_${Date.now().toString().slice(-4)}`;
        const rzpOrder = await createRazorpayOrder(totalPayable, receiptId);

        if (!booking.paymentDetails) booking.paymentDetails = {};
        booking.paymentDetails.razorpayOrderId = rzpOrder.id;
        booking.paymentMethod = 'Online';
        booking.paymentStatus = 'Pending';
        await booking.save();

        return res.status(200).json({
            success: true,
            message: "Fresh Razorpay payment order generated.",
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount,
            razorpayOrderId: rzpOrder.id,
            bookingId: booking.bookingId,
            bookingMongoId: booking._id,
            totalPayable
        });

    } catch (error) {
        console.error("retryNursePayment Error:", error);
        res.status(500).json({ success: false, message: error.message || "Internal Server Error in retryNursePayment." });
    }
};

// @desc    Get Detailed Live Nurse Service Tracking Timeline, Staff Location & Session Timer
// @route   GET /user/nurse/track/:id
// @access  Private (User)
// @desc    Get Detailed Live Nurse Service Tracking Timeline, Staff Location & Session Timer
// @route   GET /user/nurse/track/:id
// @access  Private (User)
const getAppointmentStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id || req.user?._id;

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            userId,
            $or: [
                { _id: isObjectId ? new mongoose.Types.ObjectId(id) : new mongoose.Types.ObjectId() },
                { bookingId: String(id).trim() }
            ]
        };

        const booking = await NurseBooking.findOne(query)
            .populate('nurseId', 'name speciality profileImage city address phone rating location')
            .populate('assignedStaffId', 'name phone vehicleNumber profilePic vehicleType location status')
            .populate('serviceId', 'title description')
            .populate('packageId', 'packageName description')
            .lean();

        if (!booking) {
            return res.status(404).json({ success: false, message: "Nurse booking record not found." });
        }

        const isExpress = Number(booking.priceBreakdown?.fasterServiceCharge || 0) > 0;
        const isHospital = booking.assessmentLocation === 'At Hospital';

        // 5-Step Nurse Service Progress Timeline
        const trackingTimeline = [
            {
                step: 1,
                title: "Booking Confirmed",
                description: `Order confirmed via ${booking.paymentMethod || 'COD'}`,
                time: booking.createdAt,
                isCompleted: true,
                isCurrent: booking.status === 'Confirmed' || booking.status === 'Pending'
            },
            {
                step: 2,
                title: "Staff Nurse Assigned",
                description: booking.assignedStaffId ? `Staff Nurse ${booking.assignedStaffId.name} assigned` : "Assigning certified nurse",
                time: ['Assigned', 'On-The-Way', 'Arrived', 'Service-Started', 'Completed'].includes(booking.status) ? booking.updatedAt : null,
                isCompleted: ['Assigned', 'On-The-Way', 'Arrived', 'Service-Started', 'Completed'].includes(booking.status),
                isCurrent: booking.status === 'Assigned'
            },
            {
                step: 3,
                title: isExpress ? "Nurse En-Route (Express 1-Hr)" : "Nurse En-Route to Location",
                description: booking.assignedStaffId ? `Nurse is on the way to ${isHospital ? 'hospital ward' : 'doorstep'}` : "Nurse departing shortly",
                time: booking.startedAt || null,
                isCompleted: ['Arrived', 'Service-Started', 'Completed'].includes(booking.status),
                isCurrent: booking.status === 'On-The-Way'
            },
            {
                step: 4,
                title: "Care Session In-Progress",
                description: `Service timer active. Share Start OTP: ${booking.serviceOTP || '----'}`,
                time: booking.startedAt || null,
                isCompleted: ['Service-Started', 'Completed'].includes(booking.status),
                isCurrent: ['Service-Started', 'Arrived'].includes(booking.status)
            },
            {
                step: 5,
                title: "Service Completed",
                description: "Session finished. Completion OTP verified",
                time: booking.completedAt || null,
                isCompleted: booking.status === 'Completed',
                isCurrent: booking.status === 'Completed'
            }
        ];

        res.status(200).json({
            success: true,
            data: {
                _id: booking._id,
                bookingId: booking.bookingId,
                status: booking.status,
                paymentStatus: booking.paymentStatus,
                paymentMethod: booking.paymentMethod || 'COD',
                isCod: (booking.paymentMethod === 'COD'),
                assessmentLocation: booking.assessmentLocation,
                hospitalDetails: booking.hospitalDetails || null,
                serviceDetails: booking.serviceDetails,

                serviceOTP: booking.serviceOTP || null,
                completionOTP: booking.completionOTP || null,

                startedAt: booking.startedAt || null,
                completedAt: booking.completedAt || null,
                serviceNotes: booking.serviceNotes || null,
                progressPhotos: booking.progressPhotos || [],

                schedule: {
                    duration: booking.schedule?.duration,
                    startDate: booking.schedule?.startDate ? moment(booking.schedule.startDate).format('YYYY-MM-DD') : null,
                    endDate: booking.schedule?.endDate ? moment(booking.schedule.endDate).format('YYYY-MM-DD') : null,
                    startTime: booking.schedule?.startTime,
                    endTime: booking.schedule?.endTime
                },

                // 🚨 FIXED: Replaced undefined `b` variable with `booking`
                billSummary: {
                    baseServicePrice: Number(booking.priceBreakdown?.baseServicePrice || 0),
                    originalBasePrice: Number(booking.priceBreakdown?.originalBasePrice || booking.priceBreakdown?.baseServicePrice || 0),
                    slotSurcharge: Number(booking.priceBreakdown?.slotSurcharge || 0),
                    consumableTotal: Number(booking.priceBreakdown?.consumableTotal || 0),
                    fasterServiceCharge: Number(booking.priceBreakdown?.fasterServiceCharge || 0),
                    couponDiscount: Number(booking.priceBreakdown?.couponDiscount || 0),
                    taxAmount: Number(booking.priceBreakdown?.taxAmount || 0),
                    totalAmount: Number(booking.priceBreakdown?.totalPrice || 0)
                },

                nurseBureau: {
                    id: booking.nurseId?._id || null,
                    name: booking.nurseId?.name || "Nurse Bureau",
                    speciality: booking.nurseId?.speciality || "General Nursing",
                    city: booking.nurseId?.city || "",
                    phone: booking.nurseId?.phone || "",
                    image: booking.nurseId?.profileImage || null,
                    rating: booking.nurseId?.rating || 4.8
                },

                assignedStaff: booking.assignedStaffId ? {
                    id: booking.assignedStaffId._id,
                    name: booking.assignedStaffId.name,
                    phone: booking.assignedStaffId.phone,
                    vehicleNumber: booking.assignedStaffId.vehicleNumber,
                    profilePic: booking.assignedStaffId.profilePic,
                    status: booking.assignedStaffId.status,
                    currentLocation: booking.assignedStaffId.location || { lat: 0, lng: 0 }
                } : null,

                patients: booking.patients || [],
                selectedConsumables: booking.selectedConsumables || [],
                deliveryAddress: booking.address || null,
                trackingTimeline
            }
        });

    } catch (error) {
        console.error("getAppointmentStatus Error:", error);
        res.status(500).json({ success: false, message: error.message || "Internal Server Error in tracking nurse appointment." });
    }
};

// 4. UPLOAD PRESCRIPTION (Figma Screen: Add Prescription)
const uploadBookingPrescription = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Please upload a prescription" });

        const booking = await NurseBooking.findByIdAndUpdate(
            req.params.id,
            { prescriptionImage: req.file.path },
            { new: true }
        );
        res.json({ success: true, message: "Prescription Added", data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// @desc    Get User Nurse Bookings with Service Mode, Duration & Status Badges
// @route   GET /user/nurse/my-appointments
// @access  Private (User)
const getMyNurseBookings = async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        const { status, page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let query = { userId };
        if (status && status !== 'All') {
            query.status = status;
        }

        const totalBookings = await NurseBooking.countDocuments(query);
        const bookings = await NurseBooking.find(query)
            .populate('nurseId', 'name speciality profileImage city address phone rating')
            .populate('assignedStaffId', 'name phone vehicleNumber profilePic')
            .populate('serviceId', 'title description')
            .populate('packageId', 'packageName description')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const formattedBookings = bookings.map(b => {
            const isExpress = Number(b.priceBreakdown?.fasterServiceCharge || 0) > 0;
            const isHospital = b.assessmentLocation === 'At Hospital';

            let modeLabel = "Standard Home Visit";
            let modeType = "STANDARD_HOME";

            if (isHospital) {
                modeLabel = "Hospital Bedside Care";
                modeType = "HOSPITAL_CARE";
            } else if (isExpress) {
                modeLabel = "Express Priority Visit";
                modeType = "EXPRESS_VISIT";
            } else if (b.schedule?.duration === 'For Multiple Days') {
                modeLabel = `Multi-Day Care (${b.serviceDetails?.duration || ''})`;
                modeType = "MULTI_DAY";
            } else if (b.schedule?.duration === 'Acc. To Per/Hours') {
                modeLabel = `Hourly Care (${b.serviceDetails?.duration || ''})`;
                modeType = "HOURLY";
            }

            return {
                _id: b._id,
                bookingId: b.bookingId,
                status: b.status,
                paymentStatus: b.paymentStatus,
                paymentMethod: b.paymentMethod || 'COD',
                isCod: (b.paymentMethod === 'COD'),
                bookingType: b.bookingType || 'Regular',
                createdAt: b.createdAt,
                formattedDate: moment(b.createdAt).format('DD MMM YYYY, hh:mm A'),

                serviceDetails: b.serviceDetails,
                assessmentLocation: b.assessmentLocation,
                hospitalDetails: b.hospitalDetails || null,

                deliveryMode: {
                    type: modeType,
                    label: modeLabel,
                    isExpress,
                    fasterServiceCharge: b.priceBreakdown?.fasterServiceCharge || 0,
                    slotSurcharge: b.priceBreakdown?.slotSurcharge || 0
                },

                schedule: {
                    duration: b.schedule?.duration,
                    startDate: b.schedule?.startDate ? moment(b.schedule.startDate).format('YYYY-MM-DD') : null,
                    endDate: b.schedule?.endDate ? moment(b.schedule.endDate).format('YYYY-MM-DD') : null,
                    formattedSchedule: `${moment(b.schedule?.startDate).format('DD MMM YYYY')} (${b.schedule?.startTime || ''} - ${b.schedule?.endTime || ''})`,
                    startTime: b.schedule?.startTime,
                    endTime: b.schedule?.endTime
                },

                billSummary: {
                    baseServicePrice: Number(b.priceBreakdown?.baseServicePrice || 0),
                    originalBasePrice: Number(b.priceBreakdown?.originalBasePrice || b.priceBreakdown?.baseServicePrice || 0),
                    slotSurcharge: Number(b.priceBreakdown?.slotSurcharge || 0),
                    consumableTotal: Number(b.priceBreakdown?.consumableTotal || 0),
                    fasterServiceCharge: Number(b.priceBreakdown?.fasterServiceCharge || 0),
                    couponDiscount: Number(b.priceBreakdown?.couponDiscount || 0),
                    taxAmount: Number(b.priceBreakdown?.taxAmount || 0),
                    totalAmount: Number(b.priceBreakdown?.totalPrice || 0)
                },

                nurseBureau: {
                    id: b.nurseId?._id || null,
                    name: b.nurseId?.name || "Nurse Provider",
                    speciality: b.nurseId?.speciality || "General Nursing",
                    city: b.nurseId?.city || "",
                    phone: b.nurseId?.phone || "",
                    image: b.nurseId?.profileImage || null,
                    rating: b.nurseId?.rating || 4.8
                },

                assignedStaff: b.assignedStaffId ? {
                    id: b.assignedStaffId._id,
                    name: b.assignedStaffId.name,
                    phone: b.assignedStaffId.phone,
                    vehicleNumber: b.assignedStaffId.vehicleNumber,
                    profilePic: b.assignedStaffId.profilePic
                } : null,

                serviceOTP: b.serviceOTP || null,
                completionOTP: b.completionOTP || null,
                patients: b.patients || [],
                selectedConsumables: b.selectedConsumables || [],
                deliveryAddress: b.address || null
            };
        });

        res.status(200).json({
            success: true,
            totalBookings,
            totalPages: Math.ceil(totalBookings / parseInt(limit)),
            currentPage: parseInt(page),
            data: formattedBookings
        });

    } catch (error) {
        console.error("getMyNurseBookings Error:", error);
        res.status(500).json({ success: false, message: error.message || "Internal Server Error in nurse history." });
    }
};

const rateNurseService = async (req, res) => {
    try {
        const { bookingId, rating, comment } = req.body;

        const booking = await NurseBooking.findById(bookingId);
        if (!booking || booking.status !== 'Completed') {
            return res.status(400).json({ message: "Can only rate completed services" });
        }

        // Update Nurse Model Rating Logic
        const nurse = await Nurse.findById(booking.nurseId);
        const newTotalReviews = nurse.totalReviews + 1;
        const newAverageRating = ((nurse.rating * nurse.totalReviews) + rating) / newTotalReviews;

        await Nurse.findByIdAndUpdate(booking.nurseId, {
            rating: newAverageRating.toFixed(1),
            totalReviews: newTotalReviews
        });

        // Update Booking with Review
        booking.review = { rating, comment, createdAt: new Date() };
        await booking.save();

        res.json({ success: true, message: "Thank you for your feedback!" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 1. SEARCH/FILTER NURSES (Figma: Nursing Care/Nurse list)
// POST /user/nurse/search
const searchNurses = async (req, res) => {
    try {
        const { city, speciality, search } = req.body;
        let query = { profileStatus: 'Approved', isActive: true };
        if (city) query.city = new RegExp(city, 'i');
        if (speciality) query.speciality = speciality;
        if (search) query.name = new RegExp(search, 'i');

        const nurses = await Nurse.find(query).select('-password');
        res.json({ success: true, count: nurses.length, data: nurses });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getGlobalPackages = async (req, res) => {
    try {
        const { lat, lng, search } = req.body;

        if (!lat || !lng) {
            return res.status(400).json({ success: false, message: "Location (lat, lng) is required to find nearby packages" });
        }

        // AGGREGATION PIPELINE
        const packages = await Nurse.aggregate([
            {
                // STEP 1: Find nearby Nurses first
                $geoNear: {
                    near: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
                    distanceField: "distance", // Distance calculate karke is field mein dalega
                    spherical: true,
                    query: { profileStatus: 'Approved', isActive: true } // Sirf approved vendors
                }
            },
            {
                // STEP 2: Join with NursePackage collection
                $lookup: {
                    from: "nursepackages", // MongoDB collection name (usually plural)
                    localField: "_id",
                    foreignField: "nurseId",
                    as: "vendorPackages"
                }
            },
            {
                // STEP 3: Unwind packages so each package becomes a separate document
                $unwind: "$vendorPackages"
            },
            {
                // STEP 4: Filter only Approved and Active packages
                $match: {
                    "vendorPackages.status": "Approved",
                    "vendorPackages.isActive": true,
                    ...(search ? { "vendorPackages.packageName": new RegExp(search, 'i') } : {})
                }
            },
            {
                // STEP 5: Format the output
                $project: {
                    _id: "$vendorPackages._id",
                    packageName: "$vendorPackages.packageName",
                    description: "$vendorPackages.description",
                    pricing: "$vendorPackages.pricing",
                    photos: "$vendorPackages.photos",
                    includedServices: "$vendorPackages.includedServices",
                    vendorDetails: {
                        _id: "$_id",
                        name: "$name",
                        profileImage: "$profileImage",
                        rating: "$rating",
                        city: "$city",
                        distance: { $divide: ["$distance", 1000] } // Meters to KM
                    }
                }
            },
            {
                // STEP 6: Sort by distance (Geonear already does this, but keeping it explicit)
                $sort: { "vendorDetails.distance": 1 }
            }
        ]);

        res.json({
            success: true,
            count: packages.length,
            data: packages
        });

    } catch (error) {
        console.error("Global Package Error:", error);
        res.status(500).json({ message: error.message });
    }
};



const rateNurseBooking = async (req, res) => {
    try {
        const { bookingId, rating, comment } = req.body;

        const booking = await NurseBooking.findOne({ _id: bookingId, userId: req.user.id });
        if (!booking || booking.status !== 'Completed') {
            return res.status(400).json({ success: false, message: "You can only rate completed nursing care sessions." });
        }

        const existingReview = await Review.findOne({ userId: req.user.id, orderId: bookingId });
        if (existingReview) {
            return res.status(400).json({ success: false, message: "You have already submitted a review for this care booking." });
        }

        // Create Polymorphic Review
        await Review.create({
            userId: req.user.id,
            userName: req.user.name || "Verified User",
            targetId: booking.nurseId,
            targetType: 'Nurse',
            orderId: bookingId,
            rating,
            comment: comment || ""
        });

        // Recalculate average rating & sync to Nurse profile
        const stats = await Review.aggregate([
            { $match: { targetId: booking.nurseId, targetType: 'Nurse' } },
            { $group: { _id: null, averageRating: { $avg: "$rating" }, totalReviews: { $sum: 1 } } }
        ]);

        if (stats.length > 0) {
            await Nurse.findByIdAndUpdate(booking.nurseId, {
                rating: Number(stats[0].averageRating.toFixed(1)),
                totalReviews: stats[0].totalReviews
            });
        }

        res.json({ success: true, message: "Thank you for rating your home nursing session!" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// for flutter new api 2
// 1. GET NURSE PACKAGES LIST
// endpoint: GET /user/nurse/packages/list
const getNursePackagesList = async (req, res) => {
    try {
        const { nurseId } = req.query; // Optional filter by specific Nurse bureau
        let query = { status: 'Approved', isActive: true };

        if (nurseId) {
            query.nurseId = nurseId;
        }

        // 🌟 optimization: Select only required fields to match Figma card
        const packages = await NursePackage.find(query)
            .select('_id packageName includedServices') // pricing aur bakis keys remove kar di hain
            .populate({
                path: 'includedServices',
                select: 'description' // Figma bullet points ke liye sirf description select kiya hai
            })
            .lean();

        res.json({
            success: true,
            count: packages.length,
            data: packages
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. GET NURSE PACKAGE DETAILS
// endpoint: GET /user/nurse/packages/details/:packageId
const getNursePackageDetails = async (req, res) => {
    try {
        const { packageId } = req.params;

        const nursePackage = await NursePackage.findById(packageId)
            .populate('nurseId', 'name profileImage rating city address location speciality experienceYears')
            .populate('includedServices')
            .populate('consumablesUsed.masterItemId')
            .lean();

        if (!nursePackage || nursePackage.status !== 'Approved') {
            return res.status(404).json({ success: false, message: "Package not found or inactive by admin." });
        }

        res.json({ success: true, data: nursePackage });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// NEW CONTROLLER: GET SUPPORTED MEDICAL CONDITIONS / SPECIALITIES
// endpoint: GET /user/nurse/medical-conditions
const getMedicalConditions = async (req, res) => {
    try {
        // Fetch unique approved & active nurse specialities from the Nurse collection
        const specialities = await Nurse.distinct('speciality', {
            profileStatus: 'Approved',
            isActive: true,
            speciality: { $nin: [null, ""] }
        });

        // Filter out empty/null values
        let data = specialities.filter(Boolean);

        // 🌟 Fallback Logic: Agar DB se koi bhi speciality nahi milti, to ye 4 categories return hongi
        if (data.length === 0) {
            data = [
                "Home Care Nurse",
                "Cancer Care Nurse",
                "ICU Care Nurse",
                "Complete Care Nurse"
            ];
        }

        res.json({
            success: true,
            count: data.length,
            data // Returns active DB specialities or fallback 4 default categories
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 1. GET STANDARD CATALOG SERVICES (With Available-First Sorting, Filters & Pagination)
// endpoint: GET /user/nurse/services/global?page=1&limit=20&category=...&search=...&sortBy=available_first&hasVendorsOnly=false
const getGlobalServicesList = async (req, res) => {
    try {
        const { 
            category, 
            search, 
            sortBy = 'available_first', 
            hasVendorsOnly = 'false',
            page = 1, 
            limit = 20 
        } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 20);

        let query = {};
        if (category && category !== 'All' && category.trim() !== '') {
            query.category = { $regex: new RegExp("^" + escapeRegex(category.trim()) + "$", "i") };
        }
        if (search && search.trim() !== "") {
            const cleanSearch = escapeRegex(search.trim());
            query.$or = [
                { category: { $regex: cleanSearch, $options: 'i' } },
                { subCategory: { $regex: cleanSearch, $options: 'i' } },
                { servicesOffered: { $regex: cleanSearch, $options: 'i' } }
            ];
        }

        // 1. Fetch master CSV services and all approved vendor services in parallel
        const [masterServices, allVendorServices] = await Promise.all([
            CareService.find(query).lean(),
            NurseService.find({ status: 'Approved' })
                .populate('nurseId', 'profileStatus isActive')
                .lean()
        ]);

        // Filter active & approved providers only
        const activeVendorServices = (allVendorServices || []).filter(
            vs => vs.nurseId && vs.nurseId.isActive !== false && vs.nurseId.profileStatus === 'Approved'
        );

        // 2. High-Performance in-memory enrichment
        let enrichedServices = masterServices.map((service) => {
            const serviceIdStr = String(service._id);
            const subCategoryClean = (service.subCategory || '').trim().toLowerCase();

            // Match vendor services linked to this master service ID or matching title
            const matchingVendors = activeVendorServices.filter(vs => {
                const isIdMatch = vs.careSubCategoryId && String(vs.careSubCategoryId) === serviceIdStr;
                const isTitleMatch = vs.title && String(vs.title).trim().toLowerCase() === subCategoryClean;
                return isIdMatch || isTitleMatch;
            });

            let minPrice = service.oneDayOneTimePrice || service.pricePerHour || 0;

            if (matchingVendors.length > 0) {
                const prices = matchingVendors.map(vs => {
                    return Number(vs.pricing?.oneDay?.final || vs.pricing?.hourly?.final || 0);
                }).filter(p => p > 0);

                if (prices.length > 0) {
                    minPrice = Math.min(...prices);
                }
            }

            return {
                _id: service._id,
                category: service.category || "NURSING CARE",
                subCategory: service.subCategory || "",
                description: service.description || "",
                procedureIncluded: service.procedureIncluded || "",
                servicesOffered: service.servicesOffered || "NURSING CARE",
                prescriptionRequired: String(service.prescriptionStatus).toUpperCase() === 'YES',
                categoryUrl: service.categoryUrl || "",
                defaultOneDayPrice: Number(service.oneDayOneTimePrice || 0),
                defaultHourlyPrice: Number(service.pricePerHour || 0),
                defaultMultiDayPrice: Number(service.forMultipleDaysPrice || 0),
                minPrice: Number(minPrice || 0),
                providerCount: matchingVendors.length,
                hasActiveVendors: matchingVendors.length > 0
            };
        });

        // 3. Optional Filter: Only services that have active vendor listings
        if (hasVendorsOnly === 'true' || hasVendorsOnly === true) {
            enrichedServices = enrichedServices.filter(s => s.hasActiveVendors === true);
        }

        // 4. SMART MULTI-TIER SORTING ENGINE (Available vendors always on top)
        enrichedServices.sort((a, b) => {
            // First priority: Available services on TOP
            if (a.hasActiveVendors !== b.hasActiveVendors) {
                return a.hasActiveVendors ? -1 : 1;
            }

            // Second priority: User selected sortBy
            switch (sortBy) {
                case 'price_asc':
                    return a.minPrice - b.minPrice;
                case 'price_desc':
                    return b.minPrice - a.minPrice;
                case 'popularity':
                    return b.providerCount - a.providerCount;
                case 'name_asc':
                    return a.subCategory.localeCompare(b.subCategory);
                case 'available_first':
                default:
                    // Highest provider count first, then lowest price
                    if (b.providerCount !== a.providerCount) {
                        return b.providerCount - a.providerCount;
                    }
                    return a.minPrice - b.minPrice;
            }
        });

        // 5. PAGINATION SLICING
        const totalItems = enrichedServices.length;
        const totalPages = Math.ceil(totalItems / limitNum) || 1;
        const skip = (pageNum - 1) * limitNum;
        const paginatedData = enrichedServices.slice(skip, skip + limitNum);

        res.status(200).json({
            success: true,
            pagination: {
                totalItems,
                totalPages,
                currentPage: pageNum,
                limit: limitNum,
                hasNextPage: pageNum < totalPages,
                hasPrevPage: pageNum > 1
            },
            data: paginatedData
        });

    } catch (error) {
        console.error("Get Global Services Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. GET VENDORS OFFERING A SELECTED CSV MASTER SERVICE
// endpoint: GET /user/nurse/services/providers?serviceId=...&subCategory=...&userLat=...&userLng=...
const getProvidersForService = async (req, res) => {
    try {
        const { serviceId, subCategory, userLat, userLng } = req.query;

        let matchQuery = { status: 'Approved' };

        const orConditions = [];
        if (serviceId) {
            orConditions.push({ careSubCategoryId: serviceId });
        }

        if (subCategory && subCategory.trim() !== '') {
            orConditions.push({ 
                title: { $regex: new RegExp("^" + escapeRegex(subCategory.trim()) + "$", "i") } 
            });
        }

        if (orConditions.length > 0) {
            matchQuery.$or = orConditions;
        }

        // Fetch vendor service offerings
        const vendorServices = await NurseService.find(matchQuery)
            .populate('nurseId', 'name email phone city state address rating totalReviews profileImage location isActive profileStatus is24x7')
            .populate('consumablesUsed.masterItemId', 'itemName size mrp unitType')
            .sort({ 'pricing.oneDay.final': 1 })
            .lean();

        // Filter active & approved providers only
        const activeList = vendorServices.filter(
            item => item.nurseId && item.nurseId.isActive !== false && item.nurseId.profileStatus === 'Approved'
        );

        // Distance Calculation
        const providersWithDistance = await Promise.all(activeList.map(async (item) => {
            const nurse = item.nurseId;
            let distance = 0;

            if (userLat && userLng && nurse.location?.lat && nurse.location?.lng) {
                distance = await getDistance(
                    parseFloat(userLat),
                    parseFloat(userLng),
                    Number(nurse.location.lat),
                    Number(nurse.location.lng)
                );
            }

            return {
                serviceId: item._id,
                masterServiceId: item.careSubCategoryId || null,
                serviceTitle: item.title,
                serviceDescription: item.description,
                pricing: item.pricing,
                consumablesUsed: item.consumablesUsed,
                prescriptionRequired: item.prescriptionRequired,
                nurseId: nurse._id,
                nurseName: nurse.name,
                nurseCity: nurse.city,
                nurseAddress: nurse.address,
                nurseRating: nurse.rating || 4.5,
                totalReviews: nurse.totalReviews || 0,
                profileImage: nurse.profileImage || null,
                distance: Number(distance.toFixed(2))
            };
        }));

        // Sort: Nearest first, then lowest price first
        providersWithDistance.sort((a, b) => (a.distance - b.distance) || (a.pricing?.oneDay?.final - b.pricing?.oneDay?.final));

        res.json({
            success: true,
            count: providersWithDistance.length,
            data: providersWithDistance
        });

    } catch (error) {
        console.error("Get Providers For Service Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Cancel Nurse Booking with Dynamic Cancellation Policy, Refund & Wallet Compensation
// @route   PATCH /user/nurse/cancel/:id
// @access  Private (User)
const cancelNurseBooking = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const userId = req.user?.id || req.user?._id;

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            userId,
            $or: [
                { _id: isObjectId ? new mongoose.Types.ObjectId(id) : new mongoose.Types.ObjectId() },
                { bookingId: String(id).trim() }
            ]
        };

        const booking = await NurseBooking.findOne(query);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        // 1. Block cancellation if already finished or cancelled
        const terminalStates = ['Completed', 'Cancelled'];
        if (terminalStates.includes(booking.status)) {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot cancel booking. Current status is already '${booking.status}'.` 
            });
        }

        // 2. Evaluate Dynamic Cancellation Refund Policy
        const policyResult = await processCancellationRefund(booking, 'Nurse');

        // 3. Update Booking State
        booking.status = 'Cancelled';
        booking.cancelReason = reason || "Cancelled by Patient";
        if (!booking.priceBreakdown) booking.priceBreakdown = {};
        booking.priceBreakdown.cancellationFeeApplied = policyResult.cancellationFee;

        // If online paid and refund due
        if (booking.paymentStatus === 'Paid') {
            booking.paymentStatus = policyResult.refundAmount > 0 ? 'Refund-Initiated' : 'Refunded';
        }

        await booking.save();

        // 4. Release Assigned Staff Nurse back to Available state
        if (booking.assignedStaffId) {
            await Driver.findByIdAndUpdate(booking.assignedStaffId, { 
                $set: { status: 'Available' } 
            });
        }

        // 5. Credit Cancellation Compensation to Nurse Bureau Wallet (if nurse already departed)
        if (policyResult.cancellationFee > 0 && booking.nurseId) {
            await creditVendorCompensation(
                booking.nurseId,
                'Nurse',
                policyResult.cancellationFee,
                booking.bookingId || booking._id.toString(),
                'Cancellation Compensation Fee'
            );
        }

        // 6. Restore Subscription Benefit Quota if used
        if (booking.priceBreakdown?.baseServicePrice === 0) {
            await refundBenefitCount(userId, 'freeNurseVisitsCount');
            console.log(`🔄 [Subscription Sync]: Refunded 1 free nurse visit benefit to User ${userId}`);
        }

        // 7. Push Notification to Nurse Bureau
        try {
            await notifyAdminsAndVendor(
                booking.nurseId,
                'nurse',
                "⚠️ Nurse Booking Cancelled by Patient",
                `Booking #${booking.bookingId} was cancelled. ${policyResult.cancellationFee > 0 ? `₹${policyResult.cancellationFee} compensation credited to your wallet.` : ''}`,
                { bookingId: booking._id.toString(), type: 'nurse_booking_cancelled' }
            );
        } catch (e) {}

        res.status(200).json({
            success: true,
            message: policyResult.cancellationFee > 0
                ? `Booking cancelled. A late cancellation charge of ₹${policyResult.cancellationFee} was applied. Refund of ₹${policyResult.refundAmount} has been initiated.`
                : "Booking cancelled successfully. Full refund initiated.",
            data: {
                bookingId: booking.bookingId,
                status: booking.status,
                cancellationFee: policyResult.cancellationFee,
                refundAmount: policyResult.refundAmount,
                paymentStatus: booking.paymentStatus
            }
        });

    } catch (error) {
        console.error("cancelNurseBooking Error:", error);
        res.status(500).json({ success: false, message: error.message || "Internal Server Error in cancelling nurse booking." });
    }
};




module.exports = {
    getNurses, getNurseDetails, searchNursesAndServices, searchNurses, checkoutNurseBooking, placeNurseBooking, verifyNursePayment,retryNursePayment, checkRangeAvailability, getNurseAvailability, getMyNurseBookings, rateNurseService, rateNurseBooking,
    getAppointmentStatus,
    uploadBookingPrescription, getNurseDeliveryConfig, getGlobalPackages, getAvailableCoupons,getRegisteredHospitalsDropdown, validateCoupon, getNursePackagesList,
    getNursePackageDetails, getMedicalConditions,
    getGlobalServicesList, getProvidersForService, cancelNurseBooking
};