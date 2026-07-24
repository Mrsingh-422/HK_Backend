const Nurse = require('../../../models/Nurse');
const NurseBooking = require('../../../models/NurseBooking');
const NurseService = require('../../../models/NurseService');
const NursePackage = require('../../../models/NursePackage'); 
const Availability = require('../../../models/Availability');
const DeliveryCharge = require('../../../models/DeliveryCharge');
const { isNurseAvailable, generateNurseSlots } = require('../../../utils/timeSlotHelper');
const NurseConsumable = require('../../../models/MasterConsumable');
const Coupon = require('../../../models/Coupon');
const Review = require('../../../models/Review');

// const { generateNurseSlots } = require('../../../utils/timeSlotHelper');
const mongoose = require('mongoose');
const moment = require('moment');
const crypto = require('crypto');

const { createRazorpayOrder, verifyRazorpaySignature , fetchAndMapRazorpayPayment } = require('../../../utils/razorpay'); // 👈 Razorpay Helpers Imported
const { sendPushNotification, notifyAdminsAndVendor } = require('../../../utils/notification'); // For Notifications
const { checkAndApplyBenefit, deductBenefitCount,refundBenefitCount } = require('../../../utils/subscriptionBenefitHelper');
const { processCancellationRefund } = require('../../../utils/policyHelper');
const { isCodEnabled } = require('../../../utils/policyHelper');



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

const getNurseDetails = async (req, res) => {
    try {
        const nurseId = req.params.id;
        if (!nurseId) return res.status(400).json({ message: "Nurse ID required" });

        const nurse = await Nurse.findById(nurseId).lean();
        
        // 🚨 CRITICAL CHECK: Block access if nurse is inactive by Admin
        if (!nurse || nurse.isActive === false) {
            return res.status(404).json({ success: false, message: "Nurse profile is inactive or not found." });
        }

        const reviews = await Review.find({ 
            targetId: nurseId, 
            targetType: 'Nurse' 
        }).select('rating').lean();

        let averageRating = 4.8; 
        if (reviews.length > 0) {
            const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
            averageRating = Number((totalRating / reviews.length).toFixed(1)); 
        }

        const recentReviews = await Review.find({ targetId: nurseId, targetType: 'Nurse' })
            .select('userName rating comment createdAt')
            .sort({ createdAt: -1 })
            .limit(3)
            .lean();

        const [services, packages, config] = await Promise.all([
            NurseService.find({ nurseId, status: 'Approved' })
                .populate('consumablesUsed.masterItemId')
                .lean(),
            NursePackage.find({ nurseId, status: 'Approved' })
                .populate('includedServices')
                .populate('consumablesUsed.masterItemId')
                .lean(),
            Availability.findOne({ vendorId: nurseId }).lean()
        ]);

        res.json({ 
            success: true, 
            data: { 
                ...nurse, 
                rating: averageRating,           
                totalReviews: reviews.length,    
                services: services || [], 
                packages: packages || [], 
                availability: config || null,
                recentReviews,
                isOnline: nurse.isOnline ?? true // Sends online status to UI
            } 
        });
    } catch (e) { 
        console.error("Critical Details Error:", e);
        res.status(500).json({ success: false, message: "Server encountered an error loading details" }); 
    }
};

// NEW CONTROLLER: SEARCH NURSES, SERVICES & PACKAGES WITH SUGGESTIONS
// endpoint: GET /user/nurse/search-suggestions?q=query_text
const searchNursesAndServices = async (req, res) => {
    try {
        const { q } = req.query; // 'q' contains the typed query string

        // Agar query empty hai ya sirf white spaces hain
        if (!q || !q.trim()) {
            return res.json({
                success: true,
                data: {
                    suggestions: [],
                    providers: [],
                    services: [],
                    packages: []
                }
            });
        }

        const regex = new RegExp(q.trim(), 'i');

        // 1. QUERY PROVIDERS (Nurses bureaus that are Approved and Active)
        const providers = await Nurse.find({
            profileStatus: 'Approved',
            isActive: true,
            name: regex
        })
        .select('name profileImage city speciality experienceYears rating totalReviews isOnline location')
        .limit(10)
        .lean();

        // 2. QUERY SERVICES (Populate only if the associated provider is Active & Approved)
        const services = await NurseService.find({
            title: regex,
            status: 'Approved',
            isActive: true
        })
        .populate({
            path: 'nurseId',
            match: { profileStatus: 'Approved', isActive: true },
            select: 'name profileImage rating city experienceYears isOnline'
        })
        .limit(10)
        .lean();

        // Filter out services where the provider is inactive/null due to match conditions
        const validServices = services.filter(s => s.nurseId);

        // 3. QUERY PACKAGES (Populate only if associated provider is Active & Approved)
        const packages = await NursePackage.find({
            packageName: regex,
            status: 'Approved',
            isActive: true
        })
        .populate({
            path: 'nurseId',
            match: { profileStatus: 'Approved', isActive: true },
            select: 'name profileImage rating city experienceYears isOnline'
        })
        .limit(10)
        .lean();

        // Filter out packages where the provider is inactive
        const validPackages = packages.filter(p => p.nurseId);

        // 4. GENERATE AUTOCOMPLETE SUGGESTIONS LIST (Flat array of strings for easy UI type-ahead)
        const suggestions = [];

        // Add top matching provider names
        providers.slice(0, 4).forEach(p => suggestions.push(p.name));
        
        // Add top matching service titles
        validServices.slice(0, 4).forEach(s => suggestions.push(s.title));

        // Add top matching package names
        validPackages.slice(0, 4).forEach(p => suggestions.push(p.packageName));

        // Remove any duplicates from the suggestion list
        const uniqueSuggestions = [...new Set(suggestions)];

        res.json({
            success: true,
            data: {
                suggestions: uniqueSuggestions, // Used for quick autocomplete dropdown
                providers,                      // Matched Nurse bureaus
                services: validServices,        // Matched individual treatments
                packages: validPackages         // Matched health bundles
            }
        });

    } catch (error) {
        console.error("Search suggestions API error:", error);
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
// B. Updated Checkout (100% Dynamic)
const getNurseAvailability = async (req, res) => {
    try {
        const { nurseId } = req.params;
        const { serviceId, packageId, isPackage, month, year } = req.query; 

        // 1. Pagination Logic: Target Month aur Year set karein
        // Default: Current Month & Current Year
        const targetMonth = month ? parseInt(month) : moment().month() + 1; // 1-12
        const targetYear = year ? parseInt(year) : moment().year();

        // Start and End of the requested month
        const startOfMonth = moment(`${targetYear}-${targetMonth}-01`, "YYYY-MM-DD").startOf('month');
        const endOfMonth = startOfMonth.clone().endOf('month');

        // 2. Fetch Config and Item
        const [config, item] = await Promise.all([
            Availability.findOne({ vendorId: nurseId }),
            isPackage === 'true' ? NursePackage.findById(packageId) : NurseService.findById(serviceId)
        ]);

        if (!config || !item) {
            return res.status(404).json({ success: false, message: "Settings or Item not found" });
        }

        // 3. Extract Final Prices
        const prices = {
            oneDayFinal: item.pricing.oneDay.final,
            multipleDaysFinal: item.pricing.multipleDays.final,
            hourlyFinal: item.pricing.hourly.final
        };

        // 4. Generate Calendar for the WHOLE MONTH (Pagination focus)
        const calendar = [];
        let dayCounter = startOfMonth.clone();

        while (dayCounter <= endOfMonth) {
            const dateStr = dayCounter.format('YYYY-MM-DD');
            
            // Premium check for this date
            const premDate = config.premiumDates?.find(pd => pd.date === dateStr);
            const extra = premDate ? premDate.extraFee : 0;

            // Is Date ko past check karein (taaki purani dates book na hon)
            const isPast = dayCounter.isBefore(moment(), 'day');

            calendar.push({
                date: dateStr,
                pricing: {
                    oneDayPrice: Math.round(prices.oneDayFinal + extra),
                    multipleDayPrice: Math.round(prices.multipleDaysFinal + extra),
                    isPremium: extra > 0,
                    extraFee: extra
                },
                isDisabled: isPast || config.offDays.includes(dayCounter.format('Wednesday')) // Example: Wednesday check
            });

            dayCounter.add(1, 'day');
        }

        // 5. Generate Hourly Slots (Inka response pattern same rahega)
        const timeSlots = generateNurseSlots(config, prices.hourlyFinal);

        // 🚀 RESPONSE: Ek bhi key change nahi ki gayi hai
        res.json({
            success: true,
            data: {
                itemTitle: isPackage === 'true' ? item.packageName : item.title,
                nurseId: nurseId,
                config: {
                    offDays: config.offDays,
                    allowedBookingTypes: config.allowedBookingTypes
                },
                prices,
                calendar, // Ab isme poore month ka data hai
                timeSlots
            }
        });

    } catch (error) {
        console.error("Availability Pagination Error:", error);
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

// 4. CHECKOUT (Updated with COD and Subscription Checks)
const checkoutNurseBooking = async (req, res) => {
    try {
        const { 
            nurseId, serviceId, packageId, isPackage, selectedType, 
            startDate, endDate, startTime, endTime, isFasterService, 
            patientCount, selectedConsumables, couponCode 
        } = req.body;

        const [item, config, delivery] = await Promise.all([
            isPackage ? NursePackage.findById(packageId) : NurseService.findById(serviceId),
            Availability.findOne({ vendorId: nurseId }),
            DeliveryCharge.findOne({ vendorId: nurseId })
        ]);

        if (!item) return res.status(404).json({ message: "Service/Package not found" });
        const pCount = Number(patientCount) || 1;
        const isCodAllowed = await isCodEnabled('Nurse');

        let basePrice = 0;
        let slotSurcharge = 0;
        let units = 1;

        if (selectedType === 'For Multiple Days') {
            units = moment(endDate).diff(moment(startDate), 'days') + 1;
            basePrice = item.pricing.multipleDays.final * units;
            let curr = moment(startDate);
            while (curr <= moment(endDate)) {
                const p = config.premiumDates?.find(pd => pd.date === curr.format('YYYY-MM-DD'));
                if (p) slotSurcharge += p.extraFee;
                curr.add(1, 'days');
            }
        } 
        else if (selectedType === 'One day One Time') {
            basePrice = item.pricing.oneDay.final;
            const pDate = config.premiumDates?.find(pd => pd.date === moment(startDate).format('YYYY-MM-DD'));
            if (pDate) slotSurcharge += pDate.extraFee;
            const pSlot = config.premiumSlots?.find(ps => ps.time === startTime);
            if (pSlot) slotSurcharge += pSlot.extraFee;
        } 
        else {
            units = moment(endTime, "HH:mm").diff(moment(startTime, "HH:mm"), 'hours') || 1;
            basePrice = item.pricing.hourly.final * units;
            const pSlot = config.premiumSlots?.find(ps => ps.time === startTime);
            if (pSlot) slotSurcharge = pSlot.extraFee;
        }

        let originalBasePrice = basePrice; 
        let isSubscriptionApplied = false;
        let planName = "";
        let userSubscriptionId = null;

        const { checkAndApplyBenefit } = require('../../../utils/subscriptionBenefitHelper');
        const nurseVisitBenefit = await checkAndApplyBenefit(req.user.id, 'freeNurseVisitsCount', basePrice);
        
        if (nurseVisitBenefit.isApplied) {
            basePrice = 0; 
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

        const consumableTotal = (selectedConsumables || []).reduce((acc, curr) => acc + (Number(curr.price) || 0), 0);
        let couponDiscount = 0;
        let couponInfo = null;
        const subTotalForCoupon = (basePrice + slotSurcharge + consumableTotal) * pCount;

        if (couponCode) {
            const coupon = await Coupon.findOne({
                couponName: couponCode.toUpperCase(),
                isActive: true,
                expiryDate: { $gte: new Date() },
                vendorType: { $in: ['Nurse', 'All'] }, // Root level check
                $or: [
                    { isAdminCreated: true }, 
                    { vendorId: nurseId } 
                ]
            });

            if (coupon) {
                if (subTotalForCoupon >= coupon.minOrderAmount) {
                    const userUsage = coupon.usedBy.find(u => u.userId.toString() === req.user.id.toString());
                    const usageCount = userUsage ? userUsage.usageCount : 0;

                    if (usageCount < coupon.maxUsagePerUser) {
                        let discount = (subTotalForCoupon * coupon.discountPercentage) / 100;
                        if (discount > coupon.maxDiscount) discount = coupon.maxDiscount;
                        
                        couponDiscount = Math.round(discount);
                        couponInfo = { couponId: coupon._id, couponName: coupon.couponName };
                    }
                }
            }
        }

        let fasterCharge = isFasterService ? (delivery?.fastDeliveryExtra || 0) : 0;
        if (isFasterService) {
            const nurseDelivBenefit = await checkAndApplyBenefit(req.user.id, 'freeNurseDeliveriesCount', fasterCharge);
            fasterCharge = nurseDelivBenefit.amount; 
        }

        const totalAfterDiscount = (subTotalForCoupon - couponDiscount) + fasterCharge;
        let tax = 0;
        if (delivery?.taxPercentage) tax = (totalAfterDiscount * delivery.taxPercentage) / 100;
        if (delivery?.taxInRupees) tax += delivery.taxInRupees;

        res.json({
            success: true,
            breakdown: {
                baseServicePrice: Math.round(basePrice * pCount),
                originalBasePrice: Math.round(originalBasePrice * pCount), 
                slotSurcharge: Math.round(slotSurcharge * pCount),
                consumableTotal: Math.round(consumableTotal * pCount),
                couponDiscount: couponDiscount, 
                fasterServiceCharge: fasterCharge,
                taxAmount: Math.round(tax),
                totalPrice: Math.round(totalAfterDiscount + tax),
                units,
                pCount,
                appliedCoupon: couponInfo
            },
            isCodAvailable: isCodAllowed, 
            subscriptionDetails: { isSubscriptionApplied, userSubscriptionId, planName }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// 5. PLACE BOOKING (Replacing placeNurseBooking with Razorpay payload creation)
// 5. PLACE BOOKING (Updated with COD and Subscription Check)
const placeNurseBooking = async (req, res) => {
    try {
        const { 
            nurseId, serviceId, packageId, isPackage, schedule, priceBreakdown, 
            patients, address, selectedConsumables, assessmentLocation, 
            appliedCoupon, paymentMethod, isFasterService 
        } = req.body;
        
        const activePaymentMethod = paymentMethod || 'COD';

        if (activePaymentMethod === 'COD') {
            const isCodAllowed = await isCodEnabled('Nurse');
            if (!isCodAllowed) {
                return res.status(400).json({
                    success: false,
                    message: "Cash on Delivery is currently disabled for nursing visits. Please pay online to complete your booking."
                });
            }
        }

        const nurse = await Nurse.findById(nurseId);
        if (!nurse) return res.status(404).json({ message: "Nurse provider not found." });

        if (nurse.isOnline === false) {
            return res.status(400).json({
                success: false,
                message: "Booking Blocked: Nurse is currently offline and not accepting bookings."
            });
        }

        const item = isPackage ? await NursePackage.findById(packageId) : await NurseService.findById(serviceId);
        const bId = `HKN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        let rzpOrder = null;
        if (activePaymentMethod !== 'COD') {
            rzpOrder = await createRazorpayOrder(priceBreakdown.totalPrice, `receipt_${bId}`);
        }

        let isSubscriptionApplied = false;
        let planName = "";
        let userSubscriptionId = null;

        if (priceBreakdown.baseServicePrice === 0) {
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

        const booking = await NurseBooking.create({
            userId: req.user.id,
            nurseId,
            serviceId: isPackage ? null : serviceId,
            packageId: isPackage ? packageId : null,
            bookingId: bId,
            serviceDetails: {
                title: isPackage ? item.packageName : item.title,
                type: isPackage ? "Package Bundle" : item.type,
                duration: schedule.duration,
                basePrice: item.pricing.oneDay.final
            },
            priceBreakdown: {
                baseServicePrice: Number(priceBreakdown.baseServicePrice || 0),
                originalBasePrice: Number(priceBreakdown.originalBasePrice || 0), 
                slotSurcharge: Number(priceBreakdown.slotSurcharge || 0),
                consumableTotal: Number(priceBreakdown.consumableTotal || 0),
                couponDiscount: Number(priceBreakdown.couponDiscount || 0),
                fasterServiceCharge: Number(priceBreakdown.fasterServiceCharge || 0),
                taxAmount: Number(priceBreakdown.taxAmount || 0),
                totalPrice: Number(priceBreakdown.totalPrice || 0)
            },
            appliedCoupon: appliedCoupon ? {
                couponId: appliedCoupon.couponId,
                discountAmount: priceBreakdown.couponDiscount,
                couponName: appliedCoupon.couponName
            } : null,
            patients,
            schedule,
            address,
            assessmentLocation,
            selectedConsumables,
            paymentMethod: activePaymentMethod,
            paymentStatus: 'Pending',
            status: activePaymentMethod === 'COD' ? 'Confirmed' : 'Pending',
            subscriptionDetails: { isSubscriptionApplied, userSubscriptionId, planName }
        });

        if (activePaymentMethod === 'COD') {
            if (appliedCoupon && appliedCoupon.couponId) {
                const coupon = await Coupon.findOne({ _id: appliedCoupon.couponId, vendorType: { $in: ['Nurse', 'All'] } }); // Root level check
                if (coupon) {
                    const userIndex = coupon.usedBy.findIndex(u => u.userId.toString() === req.user.id.toString());
                    if (userIndex > -1) {
                        coupon.usedBy[userIndex].usageCount += 1;
                    } else {
                        coupon.usedBy.push({ userId: req.user.id, usageCount: 1 });
                    }
                    await coupon.save();
                }
            }

            await deductBenefitCount(req.user.id, 'freeNurseVisitsCount');
            if (isFasterService) {
                await deductBenefitCount(req.user.id, 'freeNurseDeliveriesCount');
            }

            await notifyAdminsAndVendor(
                nurseId,
                'nurse',
                "New Nurse Booking Requested (COD)!",
                `COD Nursing service #${bId} has been requested.`,
                { bookingId: booking._id.toString(), type: 'new_nurse_booking' }
            );

            return res.status(201).json({ success: true, message: "Booking confirmed!", data: booking });
        }

        res.status(201).json({
            success: true,
            message: "Razorpay order created for Nurse booking.",
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount,
            razorpayOrderId: rzpOrder.id,
            appointmentId: booking._id,
            bookingId: bId
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};



// 🚨 NEW CONTROLLER: VERIFY NURSE BOOKING PAYMENT SIGNATURE
// endpoint: POST /user/nurse/verify-payment
const verifyNursePayment = async (req, res) => {
    try {
        const { appointmentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

        if (!appointmentId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(400).json({ success: false, message: "Missing payment verification keys." });
        }

        const isVerified = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        if (!isVerified) {
            return res.status(400).json({ success: false, message: "Invalid payment signature." });
        }

        const booking = await NurseBooking.findById(appointmentId);
        if (!booking) return res.status(404).json({ success: false, message: "Nurse booking not found." });

        const rzpDetails = await fetchAndMapRazorpayPayment(razorpayPaymentId, razorpaySignature);

        booking.status = 'Confirmed';
        booking.paymentStatus = 'Paid';
        booking.paymentMethod = 'Online';
        booking.paymentDetails = rzpDetails; 
        await booking.save();

        if (booking.appliedCoupon && booking.appliedCoupon.couponId) {
            const coupon = await Coupon.findById(booking.appliedCoupon.couponId);
            if (coupon) {
                const userIndex = coupon.usedBy.findIndex(u => u.userId && u.userId.toString() === req.user.id.toString());
                if (userIndex > -1) {
                    coupon.usedBy[userIndex].usageCount += 1;
                } else {
                    coupon.usedBy.push({ userId: req.user.id, usageCount: 1 });
                }
                await coupon.save();
            }
        }

        // 🚨 SUBSCRIPTION DEDUCTION: Online Nurse Benefits deduct karein
        await deductBenefitCount(booking.userId, 'freeNurseVisitsCount');
        if (booking.priceBreakdown?.fasterServiceCharge > 0) {
            await deductBenefitCount(booking.userId, 'freeNurseDeliveriesCount');
        }

        await notifyAdminsAndVendor(
            booking.nurseId,
            'nurse',
            "New Nurse Booking Confirmed!",
            `Paid Nurse booking #${booking.bookingId} has been successfully verified.`,
            { bookingId: booking._id.toString(), type: 'new_nurse_booking' }
        );

        res.json({
            success: true,
            message: "Nurse payment successfully verified & booking confirmed!",
            data: booking
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



// 6. TRACKING STATUS (Populated Response)
const getAppointmentStatus = async (req, res) => {
    try {
        const booking = await NurseBooking.findById(req.params.id)
            .populate('nurseId', 'name profileImage rating city address location')
            .populate('serviceId', 'title description procedureIncluded consumablesUsed')
            .populate('assignedStaffId', 'name phone profilePic status');

        if (!booking) return res.status(404).json({ message: "Booking not found" });

        // Calculate ETA Simulation (Figma: "On the way • 25 mins arrival")
        const eta = "25 mins"; 
        const distance = "3.2 km";

        res.json({ 
            success: true, 
            data: {
                ...booking._doc,
                eta,
                distance
            } 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
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




const getMyNurseBookings = async (req, res) => {
    try {
        // Query params se page aur limit lein (Default: page 1, limit 10)
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        
        // Skip calculate karein (ex: page 2 pe jana hai to 10 records skip honge)
        const skip = (page - 1) * limit;

        // Total count nikalne ke liye (taaki frontend pagination UI bana sake)
        const total = await NurseBooking.countDocuments({ userId: req.user.id });

        const bookings = await NurseBooking.find({ userId: req.user.id })
            .populate('nurseId', 'name profileImage speciality')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.json({ 
            success: true, 
            count: bookings.length, 
            totalItems: total, // Total kitne records hain
            totalPages: Math.ceil(total / limit), // Kitne total pages banenge
            currentPage: page,
            data: bookings 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
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

// 1. GET GLOBAL UNIQUE SERVICES LIST (Our Nursing Services section on Home Screen)
// endpoint: GET /user/nurse/services/global
const getGlobalServicesList = async (req, res) => {
    try {
        const services = await NurseService.find()
            .populate({
                path: 'nurseId',
                select: 'name profileStatus isActive'
            })
            .lean();

        // Step 1: Filter only those services whose associated Nurse is Approved & Active
        const validServices = services.filter(service => 
            service.nurseId && 
            service.nurseId.profileStatus === 'Approved' && 
            service.nurseId.isActive === true &&
            (service.status === 'Approved' || !service.status)
        );

        // Step 2: Grouping to get unique titles & lowest starting price (No Photo Reference)
        const uniqueMap = {};
        validServices.forEach(s => {
            const title = s.title;
            const price = s.pricing?.oneDay?.final || 0;
            
            if (!uniqueMap[title]) {
                uniqueMap[title] = {
                    _id: s._id,
                    title: title,
                    description: s.description,
                    startingPrice: price
                };
            } else {
                if (price > 0 && (uniqueMap[title].startingPrice === 0 || price < uniqueMap[title].startingPrice)) {
                    uniqueMap[title].startingPrice = price;
                }
            }
        });

        const data = Object.values(uniqueMap);

        res.json({ success: true, count: data.length, data });

    } catch (error) { 
        console.error("getGlobalServicesList Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. GET PROVIDERS FOR A SELECTED SERVICE (Lists Nurse bureaus offering that specific service)
// endpoint: GET /user/nurse/services/providers?serviceTitle=Dressing
const getProvidersForService = async (req, res) => {
    try {
        const { serviceTitle } = req.query; // e.g. "Dressing"

        if (!serviceTitle) {
            return res.status(400).json({ success: false, message: "serviceTitle query parameter is required." });
        }

        // Case-insensitive exact title match
        const serviceProviders = await NurseService.find({
            title: new RegExp(`^${serviceTitle.trim()}$`, 'i'),
            status: 'Approved' // Assures service is approved by admin
        })
        .populate({
            path: 'nurseId',
            match: { profileStatus: 'Approved', isActive: true }, // Assures provider is active & approved
            select: 'name profileImage rating city experienceYears location isOnline'
        })
        .lean();

        // Filter and map valid active providers
        const validProviders = serviceProviders
            .filter(s => s.nurseId) // Removes inactive providers
            .map(s => ({
                serviceId: s._id, // 🌟 Used for booking checkout input
                pricing: s.pricing,
                nurseDetails: {
                    _id: s.nurseId._id,
                    name: s.nurseId.name,
                    profileImage: s.nurseId.profileImage,
                    rating: s.nurseId.rating || 0,
                    city: s.nurseId.city,
                    experienceYears: s.nurseId.experienceYears || 0,
                    location: s.nurseId.location,
                    isOnline: s.nurseId.isOnline ?? true
                }
            }));

        res.json({ 
            success: true, 
            count: validProviders.length, 
            data: validProviders 
        });

    } catch (error) { 
        console.error("getProvidersForService Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

const cancelNurseBooking = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const booking = await NurseBooking.findOne({ _id: id, userId: req.user.id });
        if (!booking) {
            return res.status(404).json({ success: false, message: "Nursing booking not found." });
        }

        const terminalStates = ['Completed', 'Cancelled', 'No-Show'];
        if (terminalStates.includes(booking.status)) {
            return res.status(400).json({ success: false, message: "Cannot cancel booking in its current state." });
        }

        // 🚨 DYNAMIC POLICY EVALUATION (Checks if assigned nurse has started the trip)
        const policyResult = await processCancellationRefund(booking, 'Nurse');

        booking.status = 'Cancelled';
        booking.cancelReason = reason || "Cancelled by User";
        
        booking.priceBreakdown.cancellationFeeApplied = policyResult.cancellationFee;
        booking.paymentStatus = policyResult.cancellationFee > 0 ? 'Refund-Initiated' : 'Refunded';

        await booking.save();

        // Subscription benefit refund check
        if (booking.subscriptionDetails?.isSubscriptionApplied && booking.priceBreakdown?.baseServicePrice === 0) {
            await refundBenefitCount(booking.userId, 'freeNurseVisitsCount');
        }

        res.json({
            success: true,
            message: policyResult.cancellationFee > 0
                ? `Booking cancelled successfully. A cancellation fee of ₹${policyResult.cancellationFee} was applied.`
                : "Booking cancelled successfully. No charges applied.",
            data: {
                cancellationFee: policyResult.cancellationFee,
                refundAmount: policyResult.refundAmount,
                booking
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};




module.exports = { getNurses,getNurseDetails,searchNursesAndServices,searchNurses,checkoutNurseBooking, placeNurseBooking,verifyNursePayment,checkRangeAvailability, getNurseAvailability,getMyNurseBookings, rateNurseService, rateNurseBooking,
    getAppointmentStatus, 
    uploadBookingPrescription,getNurseDeliveryConfig, getGlobalPackages, getAvailableCoupons, validateCoupon,getNursePackagesList,
    getNursePackageDetails,getMedicalConditions,
getGlobalServicesList,getProvidersForService,cancelNurseBooking };