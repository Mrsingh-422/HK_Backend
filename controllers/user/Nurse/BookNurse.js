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
// 📅 GET NURSE AVAILABILITY (DATE-SPECIFIC SLOTS: TODAY VS FUTURE DATES)
// Endpoint: GET /user/nurse/availability/:nurseId
// =========================================================================
const getNurseAvailability = async (req, res) => {
    try {
        const { nurseId } = req.params;
        const { serviceId, packageId, isPackage, type = 'One day One Time', selectedDate, date, startDate, month, year } = req.query;

        // 1. Fetch Target Service or Package
        let targetItem = null;
        if (isPackage === 'true' || isPackage === true || packageId) {
            targetItem = await NursePackage.findById(packageId || serviceId).lean();
        } else if (serviceId) {
            targetItem = await NurseService.findById(serviceId).lean();
        }

        const baseOneDayPrice = targetItem?.pricing?.oneDay?.final || 1800;
        const baseMultiDayPrice = targetItem?.pricing?.multipleDays?.final || baseOneDayPrice;
        const baseHourlyPrice = targetItem?.pricing?.hourly?.final || 200;

        // 2. Fetch Availability Settings & Vendor Delivery Charges
        const nurseObjId = mongoose.Types.ObjectId.isValid(nurseId) ? new mongoose.Types.ObjectId(nurseId) : nurseId;
        const [availability, deliveryConfig] = await Promise.all([
            Availability.findOne({ vendorId: nurseObjId }).lean(),
            DeliveryCharge.findOne({ $or: [{ vendorId: nurseObjId }, { vendorId: nurseId }] }).lean()
        ]);

        const avail = availability || {
            startTime: "00:00",
            endTime: "23:00",
            slotDuration: 60,
            premiumDates: [],
            premiumSlots: [],
            unavailableSlots: []
        };

        const premiumDatesList = avail.premiumDates || [];
        const premiumSlotsList = avail.premiumSlots || [];
        const unavailableSlots = avail.unavailableSlots || [];
        
        const expressChargeRate = deliveryConfig?.fastDeliveryExtra !== undefined ? Number(deliveryConfig.fastDeliveryExtra) : 95;
        const travelBaseFee = deliveryConfig?.fixedPrice !== undefined ? Number(deliveryConfig.fixedPrice) : 45;

        const now = moment();
        const todayStr = now.format('YYYY-MM-DD');
        const todayStart = now.clone().startOf('day');

        // 3. Resolve Active Selected Date (supports selectedDate, date, startDate)
        const incomingDate = selectedDate || date || startDate;
        const activeDateStr = incomingDate ? moment(incomingDate).format('YYYY-MM-DD') : todayStr;
        const activeDateMoment = moment(activeDateStr, 'YYYY-MM-DD').startOf('day');

        const isToday = activeDateMoment.isSame(todayStart, 'day');
        const isFuture = activeDateMoment.isAfter(todayStart, 'day');
        const isPast = activeDateMoment.isBefore(todayStart, 'day');

        // 4. Generate Calendar Days (Supports month & year or 30-day rolling view)
        const calendar = [];
        let calStartMoment = todayStart.clone();
        let totalCalDays = 30;

        if (month && year) {
            const mIdx = parseInt(month) - 1;
            const yNum = parseInt(year);
            calStartMoment = moment([yNum, mIdx, 1]).startOf('day');
            totalCalDays = calStartMoment.daysInMonth();
        }

        for (let i = 0; i < totalCalDays; i++) {
            const dateMoment = calStartMoment.clone().add(i, 'days');
            const dStr = dateMoment.format('YYYY-MM-DD');

            const matchedPremiumDate = premiumDatesList.find(p => p.date === dStr);
            const isPremium = !!matchedPremiumDate && Number(matchedPremiumDate.extraFee || 0) > 0;
            const extraFee = isPremium ? Number(matchedPremiumDate.extraFee) : 0;

            const isDayPast = dateMoment.isBefore(todayStart, 'day');

            calendar.push({
                date: dStr,
                dayName: dateMoment.format('ddd'),
                dayNumber: dateMoment.date(),
                isDisabled: isDayPast,
                pricing: {
                    isPremium,
                    extraFee,
                    oneDayPrice: baseOneDayPrice + extraFee,
                    multipleDayPrice: baseMultiDayPrice + extraFee,
                    hourlyPrice: baseHourlyPrice
                }
            });
        }

        // 5. Generate Time Slots Grid (Strictly Evaluated According to activeDate)
        const timeSlots = [];
        const startHour = moment(avail.startTime || "00:00", "HH:mm");
        const endHour = moment(avail.endTime || "23:00", "HH:mm");
        const slotStep = avail.slotDuration || 60;

        let currentSlot = startHour.clone();
        while (currentSlot.isSameOrBefore(endHour)) {
            const slotTime24 = currentSlot.format("HH:mm");
            const isManuallyBlocked = unavailableSlots.includes(slotTime24);

            let isDisabled = isManuallyBlocked;
            let isExpressWindow = false;
            let expressAddon = 0;
            let statusLabel = "Standard";

            if (isPast) {
                // CASE A: Past Date -> All slots disabled
                isDisabled = true;
                statusLabel = "Past Date";
            } else if (isToday) {
                // CASE B: Today -> Real-Time Dynamic 1h / 1-4h evaluation
                const slotMoment = moment(`${activeDateStr} ${slotTime24}`, 'YYYY-MM-DD HH:mm');
                const diffMinutes = slotMoment.diff(now, 'minutes');

                if (diffMinutes < 60) {
                    // Less than 1 hour -> Blocked / Cannot book
                    isDisabled = true;
                    statusLabel = diffMinutes < 0 ? "Past" : "Closed (< 1h)";
                } else if (diffMinutes >= 60 && diffMinutes < 240) {
                    // 1 to 4 hours -> Express Rush Window
                    isExpressWindow = true;
                    expressAddon = expressChargeRate;
                    statusLabel = "1-3h Express Rush";
                } else {
                    // >= 4 hours -> Standard Window
                    isExpressWindow = false;
                    expressAddon = 0;
                    statusLabel = "Standard";
                }
            } else if (isFuture) {
                // CASE C: Future Date (Tomorrow & Beyond) -> ALL SLOTS ARE FULLY OPEN & STANDARD
                isDisabled = isManuallyBlocked;
                isExpressWindow = false;
                expressAddon = 0;
                statusLabel = "Standard";
            }

            if (!isManuallyBlocked) {
                const matchedPremiumSlot = premiumSlotsList.find(s => s.time === slotTime24);
                const isPremiumSlot = !!matchedPremiumSlot && Number(matchedPremiumSlot.extraFee || 0) > 0;
                const slotExtraFee = isPremiumSlot ? Number(matchedPremiumSlot.extraFee) : 0;

                const totalSlotPriceWithExpress = baseHourlyPrice + slotExtraFee + expressAddon;

                timeSlots.push({
                    time: slotTime24,
                    displayTime: currentSlot.format("hh:mm A"),
                    slotPremiumFee: slotExtraFee,
                    expressExtraFee: expressAddon,
                    hourlyBasePrice: baseHourlyPrice,
                    totalHourlyPrice: baseHourlyPrice + slotExtraFee,
                    totalSlotPriceWithExpress,
                    isExpressWindow,
                    isDisabled,
                    statusLabel,
                    isAvailable: !isDisabled
                });
            }

            currentSlot.add(slotStep, 'minutes');
        }

        res.status(200).json({
            success: true,
            data: {
                calendar,
                timeSlots,
                selectedDate: activeDateStr,
                deliveryConfig: {
                    travelBaseFee,
                    expressChargeRate
                },
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
// @desc    Validate Coupon Code for a Nurse Booking (Enforces maxUsagePerUser Limit)
// @route   POST /user/nurse/validate-coupon
// @access  Private (User)
const validateCoupon = async (req, res) => {
    try {
        const { couponCode, nurseId, totalAmount } = req.body;
        const userId = req.user.id;

        if (!couponCode) {
            return res.status(400).json({ success: false, message: "Coupon code is required." });
        }

        const cleanCode = String(couponCode).trim().toUpperCase();

        let query = {
            couponName: cleanCode,
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

        const coupon = await Coupon.findOne(query).lean();
        if (!coupon) {
            return res.status(404).json({ 
                success: false, 
                message: "Invalid or expired coupon code for nursing services." 
            });
        }

        const numTotal = Number(totalAmount || 0);
        if (numTotal < (coupon.minOrderAmount || 0)) {
            return res.status(400).json({ 
                success: false, 
                message: `Minimum order amount of ₹${coupon.minOrderAmount} is required to apply this coupon.` 
            });
        }

        // Strict Check: User's individual coupon usage count against max allowed limit
        const userUsage = coupon.usedBy?.find(u => String(u.userId) === String(userId));
        const currentUsageCount = userUsage ? Number(userUsage.usageCount || 0) : 0;
        const maxAllowed = Number(coupon.maxUsagePerUser || 1);

        if (currentUsageCount >= maxAllowed) {
            return res.status(400).json({ 
                success: false, 
                message: `Coupon usage limit reached. You can only use this coupon ${maxAllowed} time(s).` 
            });
        }

        let discountAmount = Math.round((numTotal * (coupon.discountPercentage || 0)) / 100);
        if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) {
            discountAmount = coupon.maxDiscount;
        }

        const finalPayable = Math.max(0, numTotal - discountAmount);

        res.status(200).json({
            success: true,
            message: "Coupon applied successfully!",
            data: {
                couponId: coupon._id,
                couponName: coupon.couponName,
                discountPercentage: coupon.discountPercentage,
                discountAmount,
                finalPayable,
                remainingUsages: maxAllowed - currentUsageCount
            }
        });

    } catch (error) {
        console.error("Validate Coupon Error:", error);
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
// @desc    Dynamic Pricing Engine (With Delivery/Travel Charges & Per-User Coupon Limit Check)
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
    // 1. Fetch Target Service or Package
    let targetItem = null;
    if (isPackage || packageId) {
        targetItem = await NursePackage.findById(packageId || serviceId).lean();
    } else {
        targetItem = await NurseService.findById(serviceId).lean();
    }

    if (!targetItem) {
        throw new Error("Selected Nurse Service or Package not found.");
    }

    const patients = Math.max(1, Number(patientCount) || 1);

    // 2. Base Price Calculation
    let unitBaseFee = 0;
    let stayDays = 1;
    let totalHours = 1;

    if (selectedType === 'For Multiple Days') {
        const startM = moment(startDate).startOf('day');
        const endM = moment(endDate || startDate).startOf('day');
        stayDays = Math.max(1, endM.diff(startM, 'days') + 1);
        
        const perDayRate = targetItem.pricing?.multipleDays?.final || targetItem.pricing?.oneDay?.final || 0;
        unitBaseFee = perDayRate * stayDays;

    } else if (selectedType === 'Acc. To Per/Hours') {
        if (startTime && endTime) {
            const sTime = moment(startTime, ["HH:mm", "hh:mm A"]);
            const eTime = moment(endTime, ["HH:mm", "hh:mm A"]);
            const durationMinutes = eTime.diff(sTime, 'minutes');
            totalHours = Math.max(1, Math.round(durationMinutes / 60));
        }
        const hourlyRate = targetItem.pricing?.hourly?.final || 0;
        unitBaseFee = hourlyRate * totalHours;

    } else {
        unitBaseFee = targetItem.pricing?.oneDay?.final || 0;
    }

    const baseServicePrice = Math.round(unitBaseFee * patients);

    // 3. Peak Date / Slot Surcharges
    let datePremiumFee = 0;
    let slotPremiumFee = 0;

    const nurseObjId = mongoose.Types.ObjectId.isValid(nurseId) ? new mongoose.Types.ObjectId(nurseId) : nurseId;
    const availabilityConfig = await Availability.findOne({ vendorId: nurseObjId }).lean();

    if (availabilityConfig) {
        const startDateFormatted = moment(startDate).format('YYYY-MM-DD');
        if (availabilityConfig.premiumDates && Array.isArray(availabilityConfig.premiumDates)) {
            const matchedDate = availabilityConfig.premiumDates.find(p => p.date === startDateFormatted);
            if (matchedDate && Number(matchedDate.extraFee || 0) > 0) {
                datePremiumFee = Number(matchedDate.extraFee);
            }
        }

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

    const slotSurcharge = datePremiumFee + slotPremiumFee;

    // 4. Consumables Calculation (Multiplied by Patient Count)
    let singlePatientConsumableTotal = 0;
    if (selectedConsumables && Array.isArray(selectedConsumables)) {
        selectedConsumables.forEach(c => {
            const itemPrice = Number(c.price || c.finalPrice || 0);
            singlePatientConsumableTotal += itemPrice;
        });
    }
    const consumableTotal = singlePatientConsumableTotal * patients;

    // 5. Delivery & Travel Charge Calculation
    const deliveryChargeConfig = await DeliveryCharge.findOne({
        $or: [
            { vendorId: nurseObjId },
            { vendorId: String(nurseId) },
            { vendorId: nurseId }
        ]
    }).lean();

    const vendorFixedPrice = Number(deliveryChargeConfig?.fixedPrice !== undefined ? deliveryChargeConfig.fixedPrice : 50);
    const vendorFastExtra = Number(deliveryChargeConfig?.fastDeliveryExtra !== undefined ? deliveryChargeConfig.fastDeliveryExtra : 100);
    const freeThreshold = Number(deliveryChargeConfig?.freeDeliveryThreshold !== undefined ? deliveryChargeConfig.freeDeliveryThreshold : 0);
    const vendorTaxPercent = Number(deliveryChargeConfig?.taxPercentage || 0);
    const vendorTaxFixed = Number(deliveryChargeConfig?.taxInRupees || 0);

    // 6. 1-4 Hour Rush Window Evaluation
    const now = moment();
    const isBookingToday = moment(startDate).format('YYYY-MM-DD') === now.format('YYYY-MM-DD');
    let isExpressRequired = false;
    let hoursDiffFromNow = null;

    if (isBookingToday && startTime) {
        const slotMoment = moment(`${startDate} ${startTime}`, ["YYYY-MM-DD HH:mm", "YYYY-MM-DD hh:mm A"]);
        const diffMinutes = slotMoment.diff(now, 'minutes');
        hoursDiffFromNow = diffMinutes / 60;

        if (diffMinutes < 60) {
            throw new Error("Cannot book slot within 1 hour. Minimum 1 hour preparation time is required for nurse dispatch.");
        }

        if (diffMinutes >= 60 && diffMinutes < 240) {
            isExpressRequired = true;
        }
    }

    // 7. Mutually Exclusive Travel vs Express Fee
    const isExpressActive = (isFasterService === true || isFasterService === 'true' || isExpressRequired);
    const isFreeThresholdMet = (freeThreshold > 0 && baseServicePrice >= freeThreshold);

    let fasterServiceCharge = 0;
    let travelFee = 0;

    if (isExpressActive) {
        fasterServiceCharge = vendorFastExtra;
        travelFee = 0;
    } else if (isFreeThresholdMet) {
        fasterServiceCharge = 0;
        travelFee = 0;
    } else {
        fasterServiceCharge = 0;
        travelFee = vendorFixedPrice;
    }

    // 8. Subscription Benefit Integration
    let finalBaseServicePrice = baseServicePrice;
    let isSubscriptionApplied = false;

    if (userId) {
        const visitBenefit = await checkAndApplyBenefit(userId, 'freeNurseVisitsCount', baseServicePrice);
        if (visitBenefit.isApplied) {
            finalBaseServicePrice = 0;
            isSubscriptionApplied = true;
        }
    }

    const subtotal = finalBaseServicePrice + slotSurcharge + consumableTotal + travelFee + fasterServiceCharge;

    // 9. Dynamic Tax from Vendor Config
    let taxAmount = 0;
    if (vendorTaxPercent > 0) {
        taxAmount += Math.round((subtotal * vendorTaxPercent) / 100);
    }
    if (vendorTaxFixed > 0) {
        taxAmount += Math.round(vendorTaxFixed);
    }

    // 10. Coupon Validation with Strict Per-User Usage Limit Check
    let couponDiscount = 0;
    let appliedCouponObj = null;

    if (couponCode && String(couponCode).trim() !== "") {
        const coupon = await Coupon.findOne({
            couponName: String(couponCode).toUpperCase().trim(),
            isActive: true,
            expiryDate: { $gte: new Date() }
        }).lean();

        if (coupon && subtotal >= (coupon.minOrderAmount || 0)) {
            const isVendorMatch = !coupon.vendorId || String(coupon.vendorId) === String(nurseId);
            const isTypeMatch = coupon.vendorType === 'All' || coupon.vendorType === 'Nurse';

            if (isVendorMatch && isTypeMatch) {
                let isUsageAllowed = true;
                if (userId) {
                    const userUsage = coupon.usedBy?.find(u => String(u.userId) === String(userId));
                    const currentCount = userUsage ? Number(userUsage.usageCount || 0) : 0;
                    if (currentCount >= Number(coupon.maxUsagePerUser || 1)) {
                        isUsageAllowed = false;
                    }
                }

                if (isUsageAllowed) {
                    let disc = (subtotal * coupon.discountPercentage) / 100;
                    if (coupon.maxDiscount && disc > coupon.maxDiscount) disc = coupon.maxDiscount;
                    couponDiscount = Math.round(disc);
                    appliedCouponObj = {
                        couponId: coupon._id,
                        couponName: coupon.couponName,
                        discountAmount: couponDiscount
                    };
                }
            }
        }
    }

    const finalTotalPrice = Math.max(0, Math.round(subtotal + taxAmount - couponDiscount));

    return {
        targetItem,
        breakdown: {
            baseServicePrice: finalBaseServicePrice,
            originalBasePrice: baseServicePrice,
            pCount: patients,
            totalDays: stayDays,
            totalHours,
            datePremiumFee,
            slotPremiumFee,
            slotSurcharge,
            singlePatientConsumableTotal,
            consumableTotal,
            travelFee,                       // 👈 Base Travel / Delivery Charge
            deliveryCharge: travelFee,       // 👈 Direct alias for frontend
            originalTravelFee: vendorFixedPrice,
            fasterServiceCharge,
            freeDeliveryThreshold: freeThreshold,
            isExpressRequired,
            hoursDiffFromNow: hoursDiffFromNow !== null ? Number(hoursDiffFromNow.toFixed(1)) : null,
            couponDiscount,
            taxAmount,
            totalPrice: finalTotalPrice,
            appliedCoupon: appliedCouponObj,
            isSubscriptionApplied
        }
    };
};

// @desc    Calculate and Preview Checkout Breakdown (Returns Delivery/Travel Charges)
// @route   POST /user/nurse/checkout
// @access  Private (User)
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

        const isCodAvailable = await isCodEnabled('Nurse', userId);

        res.status(200).json({
            success: true,
            message: "Nurse checkout calculation completed.",
            isCodAvailable,
            durationUnits: selectedType === 'Acc. To Per/Hours' ? breakdown.totalHours : breakdown.totalDays,
            pCount: breakdown.pCount,
            deliveryCharge: breakdown.travelFee,
            breakdown,
            data: {
                isCodAvailable,
                deliveryCharge: breakdown.travelFee,
                durationUnits: selectedType === 'Acc. To Per/Hours' ? breakdown.totalHours : breakdown.totalDays,
                pCount: breakdown.pCount,
                breakdown
            }
        });

    } catch (error) {
        console.error("Checkout Nurse Booking Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Place / Book Nursing Service or Package (Guarantees Travel Fee & Delivery Charge Persistence)
// @route   POST /user/nurse/book
// @access  Private (User)
const placeNurseBooking = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            nurseId,
            serviceId,
            packageId,
            isPackage,
            schedule,
            patients,
            healthDetails,
            address,
            assessmentLocation = 'At Home',
            selectedConsumables = [],
            hospitalDetails,
            couponCode,
            isFasterService = false
        } = req.body;

        if (!nurseId || (!serviceId && !packageId)) {
            return res.status(400).json({
                success: false,
                message: "Nurse Provider ID and Service/Package ID are required."
            });
        }

        if (!schedule || !schedule.startDate || !schedule.duration) {
            return res.status(400).json({
                success: false,
                message: "Schedule details (startDate and duration) are required."
            });
        }

        // Normalize Payment Method
        const incomingMethod = req.body.paymentMethod || req.body.payment_method || req.body.paymentMode || 'Online';
        const cleanMethodUpper = String(incomingMethod).trim().toUpperCase();
        const isCODOrder = cleanMethodUpper === 'COD' || cleanMethodUpper.includes('CASH') || cleanMethodUpper === 'PAY ON VISIT';
        const finalPaymentMethod = isCODOrder ? 'COD' : 'Online';

        // Validate COD Policy
        if (finalPaymentMethod === 'COD') {
            const isCodAllowed = await isCodEnabled('Nurse', userId);
            if (!isCodAllowed) {
                return res.status(400).json({
                    success: false,
                    message: "Cash on Delivery (COD) is currently disabled for nursing services. Please proceed with Online Payment."
                });
            }
        }

        // Check Active Nurse
        const nurse = await Nurse.findById(nurseId);
        if (!nurse || nurse.isActive === false) {
            return res.status(404).json({
                success: false,
                message: "Selected Nurse provider is not active or available."
            });
        }

        const patientList = Array.isArray(patients) && patients.length > 0 
            ? patients 
            : [{ patientId: 'Self', name: req.user.name || 'Self' }];

        // Re-use dynamic calculation engine
        const { targetItem, breakdown } = await calculateNurseBookingBreakdown({
            nurseId,
            serviceId,
            packageId,
            isPackage: isPackage === true || isPackage === 'true' || !!packageId,
            selectedType: schedule.duration,
            startDate: schedule.startDate,
            endDate: schedule.endDate,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
            isFasterService,
            patientCount: patientList.length,
            selectedConsumables,
            couponCode,
            userId
        });

        const grandTotal = breakdown.totalPrice;
        const tempBookingId = `HKN-${Date.now().toString().slice(-6)}${Math.floor(100 + Math.random() * 900)}`;

        const dynamicServiceOTP = Math.floor(1000 + Math.random() * 9000).toString();
        const dynamicCompletionOTP = Math.floor(1000 + Math.random() * 9000).toString();

        const formattedConsumables = [];
        if (Array.isArray(selectedConsumables) && selectedConsumables.length > 0) {
            selectedConsumables.forEach(c => {
                const itemPrice = Number(c.price || c.finalPrice || 0);
                formattedConsumables.push({
                    consumableId: c.consumableId || c.masterItemId || c._id,
                    itemName: c.itemName || c.name || "Medical Consumable",
                    price: itemPrice,
                    unitType: c.unitType || "Piece"
                });
            });
        }

        let planName = "";
        let userSubscriptionId = null;
        if (breakdown.isSubscriptionApplied) {
            const activeSub = await UserSubscription.findOne({
                userId,
                status: 'Active',
                endDate: { $gt: new Date() }
            }).populate('planId');
            if (activeSub && activeSub.planId) {
                planName = activeSub.planId.name || "Care Subscription Plan";
                userSubscriptionId = activeSub._id;
            }
        }

        const isFreeOrCOD = finalPaymentMethod === 'COD' || grandTotal === 0;

        const newBooking = await NurseBooking.create({
            bookingId: tempBookingId,
            userId,
            nurseId,
            serviceId: !isPackage && !packageId ? (serviceId || targetItem._id) : null,
            packageId: (isPackage || packageId) ? (packageId || targetItem._id) : null,
            bookingType: 'Regular',
            serviceDetails: {
                title: targetItem.packageName || targetItem.title,
                type: (isPackage || packageId) ? 'Package' : (targetItem.type || 'Daily Care'),
                duration: schedule.duration,
                basePrice: targetItem.pricing?.oneDay?.final || targetItem.pricing?.hourly?.final || 0,
                procedureIncluded: targetItem.procedureIncluded || "",
                servicesOffered: targetItem.servicesOffered || "NURSING CARE"
            },
            priceBreakdown: {
                baseServicePrice: breakdown.baseServicePrice,
                originalBasePrice: breakdown.originalBasePrice,
                slotSurcharge: breakdown.slotSurcharge,
                consumableTotal: breakdown.consumableTotal,
                travelFee: Number(breakdown.travelFee || 0),                     // 👈 Persisted in MongoDB
                deliveryCharge: Number(breakdown.travelFee || 0),                // 👈 Persisted in MongoDB
                originalTravelFee: Number(breakdown.originalTravelFee || 0),     // 👈 Persisted in MongoDB
                couponDiscount: breakdown.couponDiscount,
                fasterServiceCharge: breakdown.fasterServiceCharge,
                taxAmount: breakdown.taxAmount,
                totalPrice: grandTotal
            },
            totalPrice: grandTotal,
            couponCode: couponCode ? String(couponCode).toUpperCase() : null,
            appliedCoupon: breakdown.appliedCoupon,
            patients: patientList,
            assessmentLocation: assessmentLocation || 'At Home',
            hospitalDetails: assessmentLocation === 'At Hospital' ? hospitalDetails : null,
            healthDetails: healthDetails || {},
            schedule: {
                startDate: moment(schedule.startDate).startOf('day').toDate(),
                endDate: schedule.endDate ? moment(schedule.endDate).endOf('day').toDate() : moment(schedule.startDate).endOf('day').toDate(),
                startTime: schedule.startTime || "09:00",
                endTime: schedule.endTime || null,
                duration: schedule.duration
            },
            address: address || {},
            selectedConsumables: formattedConsumables,
            needConsumable: formattedConsumables.length > 0,
            serviceOTP: dynamicServiceOTP,
            completionOTP: dynamicCompletionOTP,
            paymentMethod: finalPaymentMethod,
            paymentStatus: 'Pending',
            status: isFreeOrCOD ? 'Confirmed' : 'Pending',
            subscriptionDetails: {
                isSubscriptionApplied: breakdown.isSubscriptionApplied,
                userSubscriptionId,
                planName
            }
        });

        // Increment Coupon Usage atomically for COD or 100% discount bookings
        if (breakdown.appliedCoupon && breakdown.appliedCoupon.couponId && isFreeOrCOD) {
            const existingUsage = await Coupon.findOne({ _id: breakdown.appliedCoupon.couponId, "usedBy.userId": userId });
            if (existingUsage) {
                await Coupon.updateOne(
                    { _id: breakdown.appliedCoupon.couponId, "usedBy.userId": userId },
                    { $inc: { "usedBy.$.usageCount": 1 } }
                );
            } else {
                await Coupon.findByIdAndUpdate(breakdown.appliedCoupon.couponId, {
                    $push: { usedBy: { userId, usageCount: 1 } }
                });
            }
        }

        // Deduct subscription benefit
        if (breakdown.isSubscriptionApplied && isFreeOrCOD) {
            await deductBenefitCount(userId, 'freeNurseVisitsCount');
        }

        // Online Payment Flow (Razorpay Order)
        if (finalPaymentMethod === 'Online' && grandTotal > 0) {
            const rzpOrder = await createRazorpayOrder(grandTotal, `receipt_${tempBookingId}`);

            return res.status(201).json({
                success: true,
                message: "Razorpay order initiated. Please complete payment verification to confirm booking.",
                key_id: process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID,
                amount: rzpOrder.amount,
                currency: "INR",
                razorpayOrderId: rzpOrder.id,
                bookingId: newBooking.bookingId,
                appointmentId: newBooking._id,
                paymentMethod: 'Online',
                paymentStatus: 'Pending',
                isCod: false,
                deliveryCharge: breakdown.travelFee,
                travelFee: breakdown.travelFee,
                data: newBooking
            });
        }

        // Notify Nurse Bureau for COD
        await notifyAdminsAndVendor(
            nurseId,
            'nurse',
            "New Nursing Care Booking Confirmed (COD)!",
            `Booking #${newBooking.bookingId} has been confirmed via Cash on Delivery. Please assign nurse staff.`,
            { bookingId: newBooking._id.toString(), type: 'nurse_booking_placed' }
        );

        return res.status(201).json({
            success: true,
            message: "Nursing service booking confirmed successfully via Cash on Delivery!",
            bookingId: newBooking.bookingId,
            appointmentId: newBooking._id,
            paymentMethod: 'COD',
            paymentStatus: 'Pending',
            isCod: true,
            deliveryCharge: breakdown.travelFee,
            travelFee: breakdown.travelFee,
            data: newBooking
        });

    } catch (error) {
        console.error("Place Nurse Booking Error:", error);
        res.status(500).json({ success: false, message: error.message || "Failed to place nurse booking." });
    }
};

// @desc    Verify Razorpay Payment Signature & Record Coupon Usage Count
// @route   POST /user/nurse/verify-payment
// @access  Private (User)
const verifyNursePayment = async (req, res) => {
    try {
        const { appointmentId, bookingId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

        if ((!appointmentId && !bookingId) || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(400).json({
                success: false,
                message: "appointmentId/bookingId, razorpayOrderId, razorpayPaymentId, and razorpaySignature are required."
            });
        }

        const isVerified = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        if (!isVerified && process.env.NODE_ENV === 'production') {
            return res.status(400).json({
                success: false,
                message: "Payment verification failed. Invalid transaction signature."
            });
        }

        const query = appointmentId && mongoose.isValidObjectId(appointmentId)
            ? { _id: appointmentId }
            : { bookingId: String(bookingId || appointmentId).trim() };

        const booking = await NurseBooking.findOne(query);
        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Nurse booking record not found."
            });
        }

        const paymentDetails = await fetchAndMapRazorpayPayment(razorpayPaymentId, razorpaySignature);

        booking.paymentStatus = 'Paid';
        booking.paymentMethod = 'Online';
        booking.status = 'Confirmed';
        booking.paymentDetails = paymentDetails || {
            razorpayPaymentId,
            razorpayOrderId,
            razorpaySignature,
            method: 'Online',
            amount: booking.totalPrice,
            currency: 'INR',
            status: 'captured',
            paidAt: new Date()
        };

        await booking.save();

        // 🚨 Increment Coupon Usage count upon successful online payment verification
        if (booking.appliedCoupon && booking.appliedCoupon.couponId) {
            const existingUsage = await Coupon.findOne({ _id: booking.appliedCoupon.couponId, "usedBy.userId": booking.userId });
            if (existingUsage) {
                await Coupon.updateOne(
                    { _id: booking.appliedCoupon.couponId, "usedBy.userId": booking.userId },
                    { $inc: { "usedBy.$.usageCount": 1 } }
                );
            } else {
                await Coupon.findByIdAndUpdate(booking.appliedCoupon.couponId, {
                    $push: { usedBy: { userId: booking.userId, usageCount: 1 } }
                });
            }
        }

        // Deduct subscription benefit
        if (booking.subscriptionDetails?.isSubscriptionApplied) {
            await deductBenefitCount(booking.userId, 'freeNurseVisitsCount');
        }

        // Notify Nurse Bureau
        await notifyAdminsAndVendor(
            booking.nurseId,
            'nurse',
            "Payment Received! New Nursing Booking Confirmed",
            `Online payment verified for booking #${booking.bookingId}. Please assign nurse staff.`,
            { bookingId: booking._id.toString(), type: 'nurse_booking_paid' }
        );

        res.status(200).json({
            success: true,
            message: "Payment verified successfully. Booking is now Confirmed!",
            data: booking
        });

    } catch (error) {
        console.error("Verify Nurse Payment Error:", error);
        res.status(500).json({ success: false, message: error.message || "Internal payment verification error." });
    }
};

// @desc    Retry Online Payment for a Pending Nurse Booking (Saves New Razorpay Order to DB)
// @route   POST /user/nurse/retry-payment
// @access  Private (User)
const retryNursePayment = async (req, res) => {
    try {
        const { bookingId, appointmentId } = req.body;
        const userId = req.user.id;

        const targetId = appointmentId || bookingId;
        if (!targetId) {
            return res.status(400).json({
                success: false,
                message: "appointmentId or bookingId is required to retry payment."
            });
        }

        const query = mongoose.isValidObjectId(targetId)
            ? { _id: targetId, userId }
            : { bookingId: String(targetId).trim(), userId };

        const booking = await NurseBooking.findOne(query);
        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Nurse booking record not found."
            });
        }

        if (booking.paymentStatus === 'Paid') {
            return res.status(400).json({
                success: false,
                message: "This booking is already paid and confirmed."
            });
        }

        const amountToPay = Number(booking.priceBreakdown?.totalPrice || booking.totalPrice || 0);
        if (amountToPay <= 0) {
            booking.paymentStatus = 'Paid';
            booking.status = 'Confirmed';
            await booking.save();
            return res.status(200).json({
                success: true,
                message: "Zero payable balance booking confirmed directly.",
                data: booking
            });
        }

        const rzpOrder = await createRazorpayOrder(amountToPay, `retry_${booking.bookingId}`);

        // Persist new Razorpay Order ID on booking document
        if (!booking.paymentDetails) booking.paymentDetails = {};
        booking.paymentDetails.razorpayOrderId = rzpOrder.id;
        booking.paymentMethod = 'Online';
        await booking.save();

        res.status(200).json({
            success: true,
            message: "Fresh Razorpay payment order generated.",
            key_id: process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID,
            amount: rzpOrder.amount,
            currency: "INR",
            razorpayOrderId: rzpOrder.id,
            bookingId: booking.bookingId,
            appointmentId: booking._id,
            data: booking
        });

    } catch (error) {
        console.error("Retry Nurse Payment Error:", error);
        res.status(500).json({ success: false, message: error.message || "Failed to retry payment." });
    }
};

// @desc    Track Active Nurse Booking (Exposes Live Photos, Hand-made Invoice, Daily Sessions & Staff Tracking)
// @route   GET /user/nurse/track/:id
// @access  Private (User)
const getAppointmentStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const query = mongoose.isValidObjectId(id)
            ? { _id: id, userId }
            : { bookingId: String(id).trim(), userId };

        const booking = await NurseBooking.findOne(query)
            .populate('nurseId', 'name email phone speciality profileImage experienceYears rating totalReviews city address')
            .populate('assignedStaffId', 'name phone vehicleNumber vehicleType profilePic status location')
            .populate('serviceId', 'title description procedureIncluded servicesOffered')
            .populate('packageId', 'packageName description')
            .populate('selectedConsumables.consumableId', 'itemName size mrp unitType')
            .lean();

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Nurse booking not found or unauthorized access."
            });
        }

        const rawMethod = String(booking.paymentMethod || '').trim().toUpperCase();
        const isCod = rawMethod === 'COD' || rawMethod.includes('CASH') || rawMethod === 'PAY ON VISIT';
        const isPaid = booking.paymentStatus === 'Paid' || booking.paymentStatus === 'Done';

        const fasterCharge = Number(booking.priceBreakdown?.fasterServiceCharge || 0);

        // Dynamic Travel / Delivery Fee Resolver
        let travelDeliveryFee = Number(
            booking.priceBreakdown?.travelFee !== undefined 
                ? booking.priceBreakdown.travelFee 
                : (booking.priceBreakdown?.deliveryCharge !== undefined ? booking.priceBreakdown.deliveryCharge : 0)
        );

        if (travelDeliveryFee === 0 && fasterCharge === 0 && Number(booking.totalPrice || 0) > 0) {
            const baseP = Number(booking.priceBreakdown?.baseServicePrice || 0);
            const conP = Number(booking.priceBreakdown?.consumableTotal || 0);
            const discP = Number(booking.priceBreakdown?.couponDiscount || 0);
            const slotP = Number(booking.priceBreakdown?.slotSurcharge || 0);
            const derived = Number(booking.totalPrice) - (baseP + conP + slotP - discP);
            if (derived > 0) {
                travelDeliveryFee = Math.round(derived);
            }
        }

        // OTP Visibility Security Logic
        const isStaffDispatched = ['Assigned', 'On-The-Way', 'Arrived', 'Service-Started'].includes(booking.status);
        const isSessionRunning = booking.status === 'Service-Started';

        const secureStartOTP = isStaffDispatched ? booking.serviceOTP : null;
        const secureCompletionOTP = isSessionRunning ? booking.completionOTP : null;

        res.status(200).json({
            success: true,
            data: {
                ...booking,
                paymentMethod: isCod ? 'COD' : 'Online',
                paymentStatus: booking.paymentStatus || 'Pending',
                isCod,
                isPaid,
                deliveryCharge: travelDeliveryFee,
                travelFee: travelDeliveryFee,
                priceBreakdown: {
                    ...booking.priceBreakdown,
                    travelFee: travelDeliveryFee,
                    deliveryCharge: travelDeliveryFee,
                    originalTravelFee: Number(booking.priceBreakdown?.originalTravelFee || travelDeliveryFee || 45)
                },
                // Secured OTP values based on session stage
                serviceOTP: secureStartOTP,
                completionOTP: secureCompletionOTP,

                // 📸 Live Session Photos & Handwritten Receipt Slip for User Screen
                progressPhotos: booking.progressPhotos || [],
                hasProgressPhotos: Array.isArray(booking.progressPhotos) && booking.progressPhotos.length > 0,
                handmadeInvoice: booking.handmadeInvoice || null,
                hasHandmadeInvoice: !!booking.handmadeInvoice,
                serviceNotes: booking.serviceNotes || "",

                // 🗓️ Multi-Day Sessions Log
                dailySessions: booking.dailySessions || [],

                trackingTimeline: {
                    isPending: booking.status === 'Pending',
                    isConfirmed: booking.status === 'Confirmed',
                    isAssigned: booking.status === 'Assigned',
                    isOnWay: booking.status === 'On-The-Way',
                    isArrived: booking.status === 'Arrived',
                    isStarted: booking.status === 'Service-Started',
                    isCompleted: booking.status === 'Completed',
                    isCancelled: booking.status === 'Cancelled',
                    isNoShow: booking.status === 'No-Show'
                }
            }
        });

    } catch (error) {
        console.error("Get Nurse Tracking Status Error:", error);
        res.status(500).json({ success: false, message: error.message || "Failed to fetch tracking details." });
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

// @desc    Get All Nursing Appointments for User (With Driver Uploaded Photos, Invoices & Session History)
// @route   GET /user/nurse/my-appointments
// @access  Private (User)
const getMyNurseBookings = async (req, res) => {
    try {
        const userId = req.user.id;
        const { status, page = 1, limit = 20 } = req.query;

        const query = { userId };
        if (status && status !== 'All') {
            if (status === 'Upcoming') {
                query.status = { $in: ['Confirmed', 'Assigned', 'On-The-Way', 'Arrived', 'Service-Started'] };
            } else if (status === 'History') {
                query.status = { $in: ['Completed', 'Cancelled', 'No-Show'] };
            } else if (status === 'Pending') {
                query.status = 'Pending';
            } else {
                query.status = status;
            }
        }

        const skip = (Number(page) - 1) * Number(limit);
        const total = await NurseBooking.countDocuments(query);

        const bookings = await NurseBooking.find(query)
            .populate('nurseId', 'name email phone speciality profileImage experienceYears rating totalReviews city address')
            .populate('assignedStaffId', 'name phone vehicleNumber vehicleType profilePic status location')
            .populate('serviceId', 'title description procedureIncluded servicesOffered')
            .populate('packageId', 'packageName description')
            .populate('selectedConsumables.consumableId', 'itemName size mrp unitType')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Number(limit))
            .lean();

        const enrichedBookings = bookings.map(b => {
            const rawMethod = String(b.paymentMethod || '').trim().toUpperCase();
            const isCod = rawMethod === 'COD' || rawMethod.includes('CASH') || rawMethod === 'PAY ON VISIT';
            const isPaid = b.paymentStatus === 'Paid' || b.paymentStatus === 'Done';
            const isOnline = !isCod;

            const canPayOnline = isOnline && !isPaid && !['Cancelled', 'Completed', 'No-Show'].includes(b.status);
            const canCancel = !['Completed', 'Cancelled', 'Service-Started', 'No-Show'].includes(b.status);

            const isHospital = b.assessmentLocation === 'At Hospital';
            let destinationLabel = "Home Address";
            if (isHospital && b.hospitalDetails) {
                destinationLabel = `${b.hospitalDetails.hospitalName || 'Hospital'} (${b.hospitalDetails.wardName || 'Ward'} - Bed: ${b.hospitalDetails.bedNumber || 'Bed'})`;
            } else if (b.address && b.address.houseNo) {
                destinationLabel = `${b.address.houseNo}, ${b.address.city || ''} - ${b.address.pincode || ''}`.replace(/^, |, $/g, '');
            }

            const primaryPatient = (Array.isArray(b.patients) && b.patients.length > 0)
                ? b.patients[0]
                : { name: req.user?.name || "Patient", relation: "Self" };

            let formattedScheduleDate = "";
            if (b.schedule?.startDate) {
                const sDate = moment(b.schedule.startDate).format("DD MMM YYYY");
                if (b.schedule.duration === 'For Multiple Days' && b.schedule.endDate && !moment(b.schedule.startDate).isSame(b.schedule.endDate, 'day')) {
                    const eDate = moment(b.schedule.endDate).format("DD MMM YYYY");
                    formattedScheduleDate = `${sDate} - ${eDate}`;
                } else {
                    formattedScheduleDate = sDate;
                }
            }

            let paymentDisplayLabel = "";
            if (isCod) {
                paymentDisplayLabel = isPaid ? "Cash on Delivery (Paid)" : "Cash on Delivery (Pay on Visit)";
            } else {
                paymentDisplayLabel = isPaid ? "Paid Online" : "Online (Payment Pending)";
            }

            const fasterCharge = Number(b.priceBreakdown?.fasterServiceCharge || 0);

            // Dynamic Travel / Delivery Fee Resolver
            let travelDeliveryFee = Number(
                b.priceBreakdown?.travelFee !== undefined 
                    ? b.priceBreakdown.travelFee 
                    : (b.priceBreakdown?.deliveryCharge !== undefined ? b.priceBreakdown.deliveryCharge : 0)
            );

            if (travelDeliveryFee === 0 && fasterCharge === 0 && Number(b.totalPrice || 0) > 0) {
                const baseP = Number(b.priceBreakdown?.baseServicePrice || 0);
                const conP = Number(b.priceBreakdown?.consumableTotal || 0);
                const discP = Number(b.priceBreakdown?.couponDiscount || 0);
                const slotP = Number(b.priceBreakdown?.slotSurcharge || 0);
                const derived = Number(b.totalPrice) - (baseP + conP + slotP - discP);
                if (derived > 0) {
                    travelDeliveryFee = Math.round(derived);
                }
            }

            return {
                ...b,
                paymentMethod: isCod ? 'COD' : 'Online',
                paymentStatus: b.paymentStatus || 'Pending',
                isCod,
                isOnline,
                isPaid,
                canPayOnline,
                paymentDisplayLabel,
                deliveryCharge: travelDeliveryFee,
                travelFee: travelDeliveryFee,
                priceBreakdown: {
                    ...b.priceBreakdown,
                    travelFee: travelDeliveryFee,
                    deliveryCharge: travelDeliveryFee,
                    originalTravelFee: Number(b.priceBreakdown?.originalTravelFee || travelDeliveryFee || 45)
                },
                totalAmount: Number(b.totalPrice || b.priceBreakdown?.totalPrice || 0),
                isFasterService: fasterCharge > 0,
                primaryPatientName: primaryPatient.name || primaryPatient.patientName || "Patient",
                primaryPatientRelation: primaryPatient.relation || "Self",
                patientCount: Array.isArray(b.patients) ? b.patients.length : 1,
                destinationLabel,
                formattedScheduleDate,
                formattedScheduleTime: b.schedule?.startTime ? moment(b.schedule.startTime, ["HH:mm", "hh:mm A"]).format("hh:mm A") : "09:00 AM",
                canCancel,
                isReviewed: !!(b.review && b.review.rating),

                // 📸 DRIVER UPLOADED CLINICAL PHOTOS & INVOICE SLIP (Now Visible in User Order History)
                progressPhotos: b.progressPhotos || [],
                hasProgressPhotos: Array.isArray(b.progressPhotos) && b.progressPhotos.length > 0,
                handmadeInvoice: b.handmadeInvoice || null,
                hasHandmadeInvoice: !!b.handmadeInvoice,
                serviceNotes: b.serviceNotes || "",
                
                // 🗓️ MULTI-DAY SESSIONS LOG WITH DAILY PHOTOS
                dailySessions: b.dailySessions || [],

                trackingTimeline: {
                    isPending: b.status === 'Pending',
                    isConfirmed: b.status === 'Confirmed',
                    isAssigned: b.status === 'Assigned',
                    isOnWay: b.status === 'On-The-Way',
                    isArrived: b.status === 'Arrived',
                    isStarted: b.status === 'Service-Started',
                    isCompleted: b.status === 'Completed',
                    isCancelled: b.status === 'Cancelled',
                    isNoShow: b.status === 'No-Show'
                }
            };
        });

        res.status(200).json({
            success: true,
            count: enrichedBookings.length,
            totalRecords: total,
            totalPages: Math.ceil(total / Number(limit)),
            currentPage: Number(page),
            data: enrichedBookings
        });

    } catch (error) {
        console.error("Get User Nurse Bookings Error:", error);
        res.status(500).json({ success: false, message: error.message || "Failed to fetch appointments." });
    }
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

// @desc    Find Nearby Nurse Bureaus Offering Packages (Vendor Marketplace with Distance)
// @route   GET or POST /user/nurse/packages/nurse
// @access  Public / User
const getGlobalPackages = async (req, res) => {
    try {
        // Support coordinates from both Query Params (GET) and Body (POST)
        const lat = req.query.lat || req.body.lat;
        const lng = req.query.lng || req.body.lng;
        const search = req.query.search || req.body.search;
        const packageName = req.query.packageName || req.body.packageName;

        if (!lat || !lng) {
            return res.status(400).json({ 
                success: false, 
                message: "Location coordinates (lat, lng) are required to discover nearby nurse vendors." 
            });
        }

        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);

        // 1. Fetch all approved & active Nurse Providers
        const allNurses = await Nurse.find({
            profileStatus: 'Approved',
            isActive: true
        }).select('_id name profileImage rating totalReviews city address location').lean();

        if (allNurses.length === 0) {
            return res.status(200).json({ success: true, count: 0, data: [] });
        }

        // 2. Build Package Match Filter
        const packageMatch = {
            status: 'Approved',
            isActive: true
        };

        const targetSearch = packageName || search;
        if (targetSearch && String(targetSearch).trim() !== '') {
            packageMatch.packageName = new RegExp(String(targetSearch).trim(), 'i');
        }

        // 3. Fetch Packages with populated included services & consumables
        const packages = await NursePackage.find(packageMatch)
            .populate('includedServices', 'category subCategory description procedureIncluded servicesOffered')
            .populate('consumablesUsed.masterItemId', 'itemName size mrp unitType')
            .lean();

        // 4. Combine Vendor Distance with Packages
        const results = [];

        for (let pkg of packages) {
            const nurse = allNurses.find(n => String(n._id) === String(pkg.nurseId));
            if (!nurse) continue;

            let distance = 0;
            if (nurse.location && nurse.location.lat && nurse.location.lng) {
                distance = await getDistance(userLat, userLng, Number(nurse.location.lat), Number(nurse.location.lng));
            }

            results.push({
                _id: pkg._id,
                packageName: pkg.packageName,
                description: pkg.description,
                pricing: pkg.pricing,
                photos: pkg.photos || [],
                includedServices: pkg.includedServices || [],
                consumablesUsed: pkg.consumablesUsed || [],
                prescriptionRequired: pkg.prescriptionRequired,
                // Full Vendor Information for Frontend Card
                vendorDetails: {
                    nurseId: nurse._id,
                    name: nurse.name,
                    profileImage: nurse.profileImage || null,
                    rating: nurse.rating || 4.5,
                    totalReviews: nurse.totalReviews || 0,
                    city: nurse.city,
                    address: nurse.address || "",
                    distance: Number(distance.toFixed(2)) // Distance in KM
                }
            });
        }

        // 5. Sort: Nearest Vendor first, then lowest One-Day Price
        results.sort((a, b) => {
            if (a.vendorDetails.distance !== b.vendorDetails.distance) {
                return a.vendorDetails.distance - b.vendorDetails.distance;
            }
            return (a.pricing?.oneDay?.final || 0) - (b.pricing?.oneDay?.final || 0);
        });

        res.status(200).json({
            success: true,
            count: results.length,
            data: results
        });

    } catch (error) {
        console.error("Global Package Vendors Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};



// ⭐ RATE NURSE SERVICE (DUAL IDENTIFIER & POLYMORPHIC REVIEW UPDATE)
// Endpoint: POST /user/nurse/rate
const rateNurseBooking = async (req, res) => {
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
            userId: new mongoose.Types.ObjectId(userId),
            $or: [
                ...(isObjectId ? [{ _id: new mongoose.Types.ObjectId(bookingId) }] : []),
                { bookingId: String(bookingId).trim() }
            ]
        };

        const booking = await NurseBooking.findOne(query);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found or access denied." });
        }

        if (booking.status !== 'Completed') {
            return res.status(400).json({ 
                success: false, 
                message: "You can only rate completed nurse care sessions." 
            });
        }

        const existingReview = await Review.findOne({ orderId: booking._id, userId });
        if (existingReview) {
            return res.status(400).json({ success: false, message: "You have already reviewed this nursing session." });
        }

        // Create Polymorphic Review
        const review = await Review.create({
            userId,
            userName: req.user.name || "Verified Patient",
            targetId: booking.nurseId,
            targetType: 'Nurse',
            orderId: booking._id,
            rating: Number(rating),
            comment: comment ? String(comment).trim() : "Service completed successfully."
        });

        // Recalculate Bureau Average Rating
        const allReviews = await Review.find({ targetId: booking.nurseId, targetType: 'Nurse' });
        const avg = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;

        await Nurse.findByIdAndUpdate(booking.nurseId, {
            $set: {
                rating: Number(avg.toFixed(1)),
                totalReviews: allReviews.length
            }
        });

        res.status(201).json({
            success: true,
            message: "Thank you! Your feedback has been submitted successfully.",
            data: review
        });

    } catch (error) {
        console.error("Rate Nurse Booking Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// for flutter new api 2
/// @desc    Get Lightweight Unique Packages List for Catalog Screen
// @route   GET /user/nurse/packages/list
// @access  Public / User
const getNursePackagesList = async (req, res) => {
    try {
        const { nurseId, search, page = 1, limit = 20 } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 20);
        const skip = (pageNum - 1) * limitNum;

        let query = { status: 'Approved', isActive: true };

        if (nurseId && mongoose.isValidObjectId(nurseId)) {
            query.nurseId = nurseId;
        }

        if (search && search.trim() !== '') {
            query.packageName = { $regex: search.trim(), $options: 'i' };
        }

        const [totalItems, packages] = await Promise.all([
            NursePackage.countDocuments(query),
            NursePackage.find(query)
                .select('_id packageName description includedServices photos')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean()
        ]);

        // Minimalistic Card Mapping
        const lightweightData = packages.map(pkg => ({
            _id: pkg._id,
            packageName: pkg.packageName,
            description: pkg.description || "",
            thumbnail: pkg.photos && pkg.photos.length > 0 ? pkg.photos[0] : null,
            totalServicesCount: Array.isArray(pkg.includedServices) ? pkg.includedServices.length : 0
        }));

        const totalPages = Math.ceil(totalItems / limitNum) || 1;

        res.status(200).json({
            success: true,
            count: lightweightData.length,
            pagination: {
                totalItems,
                totalPages,
                currentPage: pageNum,
                limit: limitNum,
                hasNextPage: pageNum < totalPages,
                hasPrevPage: pageNum > 1
            },
            data: lightweightData
        });
    } catch (error) {
        console.error("Get Lightweight Nurse Packages List Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get Single Package Deep Details (Procedures, Included Services & Consumables)
// @route   GET /user/nurse/packages/details/:packageId
// @access  Public / User
const getNursePackageDetails = async (req, res) => {
    try {
        const { packageId } = req.params;

        if (!mongoose.isValidObjectId(packageId)) {
            return res.status(400).json({ success: false, message: "Invalid Package ID format." });
        }

        const nursePackage = await NursePackage.findById(packageId)
            .populate('nurseId', 'name profileImage rating city address speciality experienceYears')
            .populate({
                path: 'includedServices',
                select: 'category subCategory description procedureIncluded servicesOffered'
            })
            .populate({
                path: 'consumablesUsed.masterItemId',
                select: 'itemName size mrp unitType category'
            })
            .lean();

        if (!nursePackage || nursePackage.status !== 'Approved') {
            return res.status(404).json({ success: false, message: "Package not found or inactive." });
        }

        res.status(200).json({
            success: true,
            data: {
                _id: nursePackage._id,
                packageName: nursePackage.packageName,
                description: nursePackage.description,
                photos: nursePackage.photos || [],
                prescriptionRequired: nursePackage.prescriptionRequired || false,
                pricing: nursePackage.pricing || {},
                includedServices: nursePackage.includedServices || [],
                consumablesUsed: nursePackage.consumablesUsed || [],
                creatorBureau: nursePackage.nurseId || null
            }
        });
    } catch (error) {
        console.error("Get Nurse Package Details Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get Nearby Vendors Offering a Specific Package Sorted by Proximity & Price
// @route   GET /user/nurse/packages/vendors/:packageId
// @access  Public / User
const getVendorsForSelectedPackage = async (req, res) => {
    try {
        const { packageId } = req.params;
        const { lat, lng, radius = 50 } = req.query;

        if (!mongoose.isValidObjectId(packageId)) {
            return res.status(400).json({ success: false, message: "Invalid Package ID format." });
        }

        if (!lat || !lng) {
            return res.status(400).json({ 
                success: false, 
                message: "Location coordinates (lat, lng) are required to discover nearby vendors." 
            });
        }

        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        const maxRadiusKm = parseFloat(radius) || 50;

        // 1. Fetch package to get package name
        const targetPackage = await NursePackage.findById(packageId).lean();
        if (!targetPackage || targetPackage.status !== 'Approved') {
            return res.status(404).json({ success: false, message: "Package not found or inactive." });
        }

        const cleanPkgName = String(targetPackage.packageName).trim();

        // 2. Find all active vendors offering this package name
        const matchingPackages = await NursePackage.find({
            packageName: { $regex: new RegExp(`^${cleanPkgName}$`, 'i') },
            status: 'Approved',
            isActive: true
        })
        .populate('nurseId', 'name profileImage rating totalReviews city address location isActive profileStatus')
        .lean();

        const vendorsList = [];

        for (let pkg of matchingPackages) {
            const nurse = pkg.nurseId;
            if (!nurse || nurse.isActive === false || nurse.profileStatus !== 'Approved') {
                continue;
            }

            let distance = 0;
            if (nurse.location && nurse.location.lat && nurse.location.lng) {
                distance = await getDistance(
                    userLat, 
                    userLng, 
                    Number(nurse.location.lat), 
                    Number(nurse.location.lng)
                );
            }

            if (distance <= maxRadiusKm) {
                vendorsList.push({
                    packageId: pkg._id,
                    packageName: pkg.packageName,
                    pricing: pkg.pricing,
                    oneDayPrice: pkg.pricing?.oneDay?.final || 0,
                    multipleDaysPrice: pkg.pricing?.multipleDays?.final || 0,
                    hourlyPrice: pkg.pricing?.hourly?.final || 0,
                    vendor: {
                        nurseId: nurse._id,
                        name: nurse.name,
                        profileImage: nurse.profileImage || null,
                        city: nurse.city || "",
                        address: nurse.address || "",
                        rating: nurse.rating || 4.5,
                        totalReviews: nurse.totalReviews || 0,
                        distance: Number(distance.toFixed(2)) // in KM
                    }
                });
            }
        }

        // Sort: Nearest Distance first, then lowest One-Day Price
        vendorsList.sort((a, b) => {
            if (a.vendor.distance !== b.vendor.distance) {
                return a.vendor.distance - b.vendor.distance;
            }
            return a.oneDayPrice - b.oneDayPrice;
        });

        res.status(200).json({
            success: true,
            selectedPackageName: cleanPkgName,
            totalNearbyVendors: vendorsList.length,
            data: vendorsList
        });

    } catch (error) {
        console.error("Get Vendors For Selected Package Error:", error);
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

// @desc    Cancel Nurse Booking by User (Handles Multi-Day Pro-Rata Refund, Staff Release & Benefit Rollback)
// @route   PATCH /user/nurse/cancel/:id
// @access  Private (User)
const cancelNurseBooking = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const userId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            userId: new mongoose.Types.ObjectId(userId),
            $or: [
                ...(isObjectId ? [{ _id: new mongoose.Types.ObjectId(id) }] : []),
                { bookingId: String(id).trim() }
            ]
        };

        const booking = await NurseBooking.findOne(query);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found or access denied." });
        }

        // Restrict cancellation only if the whole service is completely finished
        if (['Completed', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot cancel booking in '${booking.status}' state.` 
            });
        }

        // Check if an active live timer session is currently ongoing
        if (booking.status === 'Service-Started') {
            return res.status(400).json({
                success: false,
                message: "Cannot cancel while a live care session is currently in progress. Complete current session first."
            });
        }

        // 1. Multi-Day Pro-Rata Refund Calculation
        const completedSessionsCount = Array.isArray(booking.dailySessions) ? booking.dailySessions.length : 0;
        const totalDurationDays = Number(booking.priceBreakdown?.totalDays || 1);
        const grandTotalPaid = Number(booking.totalPrice || booking.priceBreakdown?.totalPrice || 0);

        let finalRefundAmount = 0;
        let policyCancellationFee = 0;

        if (completedSessionsCount > 0 && totalDurationDays > 1) {
            // Partial consumption: User consumed some days
            const perDayRate = grandTotalPaid / totalDurationDays;
            const consumedAmount = Math.round(perDayRate * completedSessionsCount);
            finalRefundAmount = Math.max(0, grandTotalPaid - consumedAmount);
            policyCancellationFee = consumedAmount;
        } else {
            // Standard single day or unstarted cancellation via policy helper
            const policyResult = await processCancellationRefund(booking, 'Nurse');
            policyCancellationFee = policyResult.cancellationFee;
            finalRefundAmount = policyResult.refundAmount;
        }

        booking.status = 'Cancelled';
        booking.cancelReason = reason || "Cancelled by Patient";

        if (!booking.priceBreakdown) booking.priceBreakdown = {};
        booking.priceBreakdown.cancellationFeeApplied = policyCancellationFee;

        // 2. Manage Payment Refund Status
        if (booking.paymentStatus === 'Paid' && finalRefundAmount > 0) {
            booking.paymentStatus = 'Refund-Initiated';
        }

        // 3. Release Assigned Staff Nurse back to Available state
        if (booking.assignedStaffId) {
            const Driver = require('../../../models/Driver');
            await Driver.findByIdAndUpdate(booking.assignedStaffId, {
                $set: { status: 'Available', isOnline: true }
            });
        }

        await booking.save();

        // 4. Rollback Coupon Usage Count if 0 sessions were consumed
        if (completedSessionsCount === 0 && booking.appliedCoupon && booking.appliedCoupon.couponId) {
            await Coupon.updateOne(
                { _id: booking.appliedCoupon.couponId, "usedBy.userId": userId },
                { $inc: { "usedBy.$.usageCount": -1 } }
            );
        }

        // 5. Restore Subscription Benefit Quota if no sessions consumed
        if (completedSessionsCount === 0 && (booking.subscriptionDetails?.isSubscriptionApplied || booking.priceBreakdown?.baseServicePrice === 0)) {
            await refundBenefitCount(userId, 'freeNurseVisitsCount');
        }

        // 6. Notify Nurse Bureau
        try {
            await sendPushNotification(
                booking.nurseId,
                'nurse',
                "⚠️ Booking Cancelled by Patient",
                `Booking #${booking.bookingId} was cancelled (${reason || 'User requested'}).`,
                { bookingId: booking._id.toString(), type: 'nurse_booking_cancelled' }
            );
        } catch (e) {}

        res.status(200).json({
            success: true,
            message: completedSessionsCount > 0
                ? `Booking cancelled. Refund of ₹${finalRefundAmount} initiated for remaining unserved days.`
                : (policyCancellationFee > 0
                    ? `Booking cancelled. A cancellation fee of ₹${policyCancellationFee} was deducted.`
                    : "Booking cancelled successfully. Full refund initiated."),
            data: {
                cancellationFee: policyCancellationFee,
                refundAmount: finalRefundAmount,
                completedSessionsCount,
                booking
            }
        });

    } catch (error) {
        console.error("Cancel Nurse Booking Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};




module.exports = {
    getNurses, getNurseDetails, searchNursesAndServices, searchNurses, checkoutNurseBooking, placeNurseBooking, verifyNursePayment,retryNursePayment, checkRangeAvailability, getNurseAvailability, getMyNurseBookings, rateNurseBooking,
    getAppointmentStatus,
    uploadBookingPrescription, getNurseDeliveryConfig, getGlobalPackages, getAvailableCoupons,getRegisteredHospitalsDropdown, validateCoupon, getNursePackagesList,
    getNursePackageDetails,getVendorsForSelectedPackage, getMedicalConditions,
    getGlobalServicesList, getProvidersForService, cancelNurseBooking
};