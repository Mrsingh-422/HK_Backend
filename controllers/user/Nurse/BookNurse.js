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
                    statusLabel = "1-4h Express Rush";
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
// 🧮 HELPER: CALCULATE PRICING (CONSUMABLES MULTIPLIED BY PATIENT COUNT)
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

    const patients = Math.max(1, Number(patientCount) || 1);

    // 2. Base Price Calculation depending on duration type
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

    // 3. Dynamic Premium Surcharges (Day 1 Peak Date + 1st Hour Peak Slot)
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

    // 🚨 4. CONSUMABLES CALCULATION (MULTIPLIED BY NUMBER OF PATIENTS)
    let singlePatientConsumableTotal = 0;
    if (selectedConsumables && Array.isArray(selectedConsumables)) {
        selectedConsumables.forEach(c => {
            const itemPrice = Number(c.price || c.finalPrice || 0);
            singlePatientConsumableTotal += itemPrice;
        });
    }
    const consumableTotal = singlePatientConsumableTotal * patients;

    // 5. Fetch Delivery/Travel Charge Settings
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

    // ⚡ 6. Real-Time Emergency 1-4 Hour Window Evaluation
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

    // 🚨 7. MUTUALLY EXCLUSIVE LOGIC (Rush Charge vs Base Fixed Travel Fare)
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

    // 9. Coupon Application
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

    const finalTotalPrice = Math.max(0, Math.round(subtotal - couponDiscount));

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
            singlePatientConsumableTotal,
            consumableTotal, // 👈 Total after multiplying with patient count
            travelFee,       // 👈 Vendor fixedPrice
            originalTravelFee: vendorFixedPrice,
            fasterServiceCharge,
            freeDeliveryThreshold: freeThreshold,
            isExpressRequired,
            hoursDiffFromNow: hoursDiffFromNow !== null ? Number(hoursDiffFromNow.toFixed(1)) : null,
            couponDiscount,
            taxAmount: 0,
            totalPrice: finalTotalPrice,
            appliedCoupon: appliedCouponObj,
            isSubscriptionApplied
        }
    };
};

// 1. CHECKOUT SUMMARY API (OUTPUTS DIRECT ROOT & DATA BREAKDOWNS)
// Endpoint: POST /user/nurse/checkout
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

        // Check COD status
        const isCodAvailable = await isCodEnabled('Nurse', userId);

        res.status(200).json({
            success: true,
            message: "Nurse checkout calculation completed.",
            isCodAvailable,
            durationUnits: selectedType === 'Acc. To Per/Hours' ? breakdown.totalHours : breakdown.totalDays,
            pCount: breakdown.pCount,
            breakdown,
            data: {
                isCodAvailable,
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

// 2. PLACE NURSE BOOKING API
// Endpoint: POST /user/nurse/book
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

        const patientList = Array.isArray(patients) && patients.length > 0 ? patients : [{
            patientId: 'Self',
            name: req.user.name || "Self",
            relation: 'Self'
        }];

        // 1. Calculate price breakdown with active surcharges, consumables & travel fee
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
            patientCount: patientList.length,
            selectedConsumables,
            couponCode,
            userId
        });

        const totalPayable = breakdown.totalPrice;
        const bookingId = `HKN-${Date.now().toString().slice(-6)}${Math.floor(100 + Math.random() * 900)}`;

        const startOtp = Math.floor(1000 + Math.random() * 9000).toString();
        const endOtp = Math.floor(1000 + Math.random() * 9000).toString();

        // 2. Build Booking Document
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
                travelFee: breakdown.travelFee,
                couponDiscount: breakdown.couponDiscount,
                fasterServiceCharge: breakdown.fasterServiceCharge,
                taxAmount: breakdown.taxAmount || 0,
                totalPrice: totalPayable
            },
            couponCode: couponCode ? String(couponCode).toUpperCase() : null,
            appliedCoupon: breakdown.appliedCoupon,
            patients: patientList,
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

            if (breakdown.appliedCoupon) {
                await Coupon.findByIdAndUpdate(breakdown.appliedCoupon.couponId, {
                    $push: { usedBy: { userId, usageCount: 1 } }
                });
            }

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

// 
// 3. VERIFY NURSE PAYMENT API (SUBSCRIPTION & COUPON DEDUCTION SYNC)
// Endpoint: POST /user/nurse/verify-payment
const verifyNursePayment = async (req, res) => {
    try {
        const { bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        if (!bookingId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: "All payment verification tokens (bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature) are required."
            });
        }

        const booking = await NurseBooking.findOne({
            $or: [
                { _id: mongoose.isValidObjectId(bookingId) ? bookingId : new mongoose.Types.ObjectId() },
                { bookingId: String(bookingId).trim() }
            ]
        });

        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        const isVerified = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
        if (!isVerified) {
            return res.status(400).json({
                success: false,
                message: "Invalid transaction signature. Verification failed."
            });
        }

        const paymentDetails = await fetchAndMapRazorpayPayment(razorpay_payment_id, razorpay_signature);

        booking.paymentStatus = 'Paid';
        booking.status = 'Confirmed';
        booking.paymentMethod = paymentDetails ? paymentDetails.method : 'Online';
        booking.paymentDetails = paymentDetails || {
            razorpayPaymentId: razorpay_payment_id,
            razorpayOrderId: razorpay_order_id,
            razorpaySignature: razorpay_signature,
            status: 'captured',
            paidAt: new Date()
        };

        await booking.save();

        // 🚨 SUBSCRIPTION SYNC: Decrement subscriber free visit quota
        if (booking.subscriptionDetails?.isSubscriptionApplied || booking.priceBreakdown?.baseServicePrice === 0) {
            await deductBenefitCount(booking.userId, 'freeNurseVisitsCount');
        }

        // 🚨 COUPON SYNC: Lock single-use coupon
        if (booking.appliedCoupon?.couponId) {
            await Coupon.findByIdAndUpdate(booking.appliedCoupon.couponId, {
                $push: { usedBy: { userId: booking.userId, usageCount: 1 } }
            });
        }

        // Notify Nurse Bureau
        try {
            await sendPushNotification(
                booking.nurseId,
                'nurse',
                "✨ Paid Nursing Booking Confirmed!",
                `Booking #${booking.bookingId} payment verified. Please assign a staff nurse.`,
                { bookingId: booking._id.toString(), type: 'nurse_booking_paid' }
            );
        } catch (e) {}

        res.status(200).json({
            success: true,
            message: "Payment verified and nurse booking confirmed successfully!",
            bookingId: booking.bookingId,
            serviceOTP: booking.serviceOTP,
            data: booking
        });

    } catch (error) {
        console.error("Verify Nurse Payment Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 🔄 RETRY NURSE ONLINE PAYMENT (DUAL IDENTIFIER SUPPORT)
// Endpoint: POST /user/nurse/retry-payment
const retryNursePayment = async (req, res) => {
    try {
        const { bookingId } = req.body;
        const userId = req.user.id;

        if (!bookingId) {
            return res.status(400).json({ success: false, message: "bookingId is required to retry payment." });
        }

        // 🛡️ Dual-Lookup with strict User Ownership Check
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
            return res.status(404).json({ success: false, message: "Booking record not found or access denied." });
        }

        if (booking.paymentStatus === 'Paid') {
            return res.status(400).json({ success: false, message: "This booking is already paid and confirmed." });
        }

        if (booking.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: "Cannot pay for a cancelled booking. Please create a new booking." });
        }

        const totalPayable = Number(booking.priceBreakdown?.totalPrice || booking.totalPrice || 0);
        if (totalPayable <= 0) {
            booking.paymentStatus = 'Paid';
            booking.status = 'Confirmed';
            await booking.save();
            return res.json({ success: true, message: "Booking confirmed with ₹0 balance.", data: booking });
        }

        // Create Fresh Razorpay Order for retry
        const rzpReceiptId = `retry_${booking.bookingId}_${Date.now().toString().slice(-4)}`;
        const rzpOrder = await createRazorpayOrder(totalPayable, rzpReceiptId);

        res.status(200).json({
            success: true,
            message: "Fresh Razorpay payment order generated.",
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount,
            razorpayOrderId: rzpOrder.id,
            bookingId: booking.bookingId,
            appointmentId: booking._id
        });

    } catch (error) {
        console.error("Retry Nurse Payment Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 📍 LIVE NURSE TRACKING & 5-STEP TIMELINE (DUAL IDENTIFIER RESOLVER)
// Endpoint: GET /user/nurse/track/:id
const getAppointmentStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            userId: new mongoose.Types.ObjectId(userId),
            $or: [
                ...(isObjectId ? [{ _id: new mongoose.Types.ObjectId(id) }] : []),
                { bookingId: String(id).trim() }
            ]
        };

        const booking = await NurseBooking.findOne(query)
            .populate('nurseId', 'name phone profileImage speciality rating address city')
            .populate('assignedStaffId', 'name phone profilePic vehicleNumber vehicleType status location')
            .populate('selectedConsumables.consumableId', 'itemName mrp unitType')
            .lean();

        if (!booking) {
            return res.status(404).json({ success: false, message: "Appointment record not found or access denied." });
        }

        const formattedSchedule = booking.schedule?.startDate
            ? `${moment(booking.schedule.startDate).format('DD MMM YYYY')} (${booking.schedule.startTime || '09:00'} - ${booking.schedule.endTime || '10:00'})`
            : "Scheduled Appointment";

        // Dynamic 5-Step Timeline Generation
        const trackingTimeline = [
            {
                step: 1,
                title: "Booking Confirmed",
                description: `Appointment confirmed via ${booking.paymentMethod || 'Online'}`,
                time: booking.createdAt,
                isCompleted: true,
                isCurrent: booking.status === 'Confirmed'
            },
            {
                step: 2,
                title: "Staff Nurse Assigned",
                description: booking.assignedStaffId ? `Staff Nurse ${booking.assignedStaffId.name} assigned` : "Bureau is assigning certified nurse staff",
                time: booking.assignedStaffId ? booking.updatedAt : null,
                isCompleted: !!booking.assignedStaffId,
                isCurrent: booking.status === 'Assigned'
            },
            {
                step: 3,
                title: "Nurse En-Route",
                description: "Nurse is traveling to your location",
                time: booking.startedAt,
                isCompleted: ['Arrived', 'Service-Started', 'Completed'].includes(booking.status),
                isCurrent: booking.status === 'On-The-Way'
            },
            {
                step: 4,
                title: "Care Session In-Progress",
                description: `Live care session active. Start OTP: ${booking.serviceOTP || '----'}`,
                time: booking.startedAt,
                isCompleted: booking.status === 'Completed',
                isCurrent: ['Service-Started', 'Arrived'].includes(booking.status)
            },
            {
                step: 5,
                title: "Service Completed",
                description: "Care session completed and verified by patient",
                time: booking.completedAt,
                isCompleted: booking.status === 'Completed',
                isCurrent: booking.status === 'Completed'
            }
        ];

        res.status(200).json({
            success: true,
            data: {
                ...booking,
                formattedSchedule,
                assignedStaff: booking.assignedStaffId || null,
                nurseBureau: booking.nurseId || null,
                trackingTimeline
            }
        });

    } catch (error) {
        console.error("Get Appointment Status Error:", error);
        res.status(500).json({ success: false, message: error.message });
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

// CANCEL NURSE BOOKING (STAFF RELEASE + REFUND POLICY + SUBSCRIPTION SYNC)
// Endpoint: PATCH /user/nurse/cancel/:id
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

        if (['Completed', 'Cancelled', 'Service-Started'].includes(booking.status)) {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot cancel booking in '${booking.status}' state.` 
            });
        }

        // 1. Process dynamic cancellation policy deductions
        const policyResult = await processCancellationRefund(booking, 'Nurse');

        booking.status = 'Cancelled';
        booking.cancelReason = reason || "Cancelled by Patient";

        if (!booking.priceBreakdown) booking.priceBreakdown = {};
        booking.priceBreakdown.cancellationFeeApplied = policyResult.cancellationFee;

        // 2. Manage Payment Refund Status
        if (booking.paymentStatus === 'Paid') {
            booking.paymentStatus = 'Refund-Initiated';
        }

        // 3. Release Assigned Staff Nurse back to Available state
        if (booking.assignedStaffId) {
            await Driver.findByIdAndUpdate(booking.assignedStaffId, {
                $set: { status: 'Available', isOnline: true }
            });
        }

        await booking.save();

        // 4. Restore Subscription Benefit Quota if used
        if (booking.subscriptionDetails?.isSubscriptionApplied || booking.priceBreakdown?.baseServicePrice === 0) {
            await refundBenefitCount(userId, 'freeNurseVisitsCount');
        }

        // 5. Notify Nurse Bureau
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
            message: policyResult.cancellationFee > 0
                ? `Booking cancelled. A late cancellation charge of ₹${policyResult.cancellationFee} was deducted.`
                : "Booking cancelled successfully. Full refund initiated.",
            data: {
                cancellationFee: policyResult.cancellationFee,
                refundAmount: policyResult.refundAmount,
                booking
            }
        });

    } catch (error) {
        console.error("Cancel Nurse Booking Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};




module.exports = {
    getNurses, getNurseDetails, searchNursesAndServices, searchNurses, checkoutNurseBooking, placeNurseBooking, verifyNursePayment,retryNursePayment, checkRangeAvailability, getNurseAvailability, getMyNurseBookings, rateNurseService, rateNurseBooking,
    getAppointmentStatus,
    uploadBookingPrescription, getNurseDeliveryConfig, getGlobalPackages, getAvailableCoupons,getRegisteredHospitalsDropdown, validateCoupon, getNursePackagesList,
    getNursePackageDetails, getMedicalConditions,
    getGlobalServicesList, getProvidersForService, cancelNurseBooking
};