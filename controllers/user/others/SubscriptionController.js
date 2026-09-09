const SubscriptionCategory = require('../../../models/SubscriptionCategory');
const SubscriptionDisease = require('../../../models/SubscriptionDisease');
const SubscriptionPlan = require('../../../models/SubscriptionPlan');
const UserSubscription = require('../../../models/UserSubscription');
const { createRazorpayOrder, verifyRazorpaySignature, fetchAndMapRazorpayPayment } = require('../../../utils/razorpay');
const moment = require('moment');

// 1. GET CATEGORIES FOR APP UI
const getUserCategories = async (req, res) => {
    try {
        const categories = await SubscriptionCategory.find({ isActive: true })
            .sort({ displayOrder: 1, createdAt: 1 })
            .lean();

        res.json({ success: true, count: categories.length, data: categories });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. GET DISEASES FOR SELECTED CATEGORY
const getUserDiseasesByCategory = async (req, res) => {
    try {
        const { categoryId, categorySlug } = req.query;
        const query = { isActive: true };

        if (categoryId) {
            query.categoryId = categoryId;
        } else if (categorySlug) {
            const cat = await SubscriptionCategory.findOne({ slug: categorySlug.toLowerCase() });
            if (cat) query.categoryId = cat._id;
        }

        const diseases = await SubscriptionDisease.find(query).sort({ name: 1 }).lean();
        res.json({ success: true, count: diseases.length, data: diseases });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. GET PLANS (Highlights VIP COD Access)
const getPlans = async (req, res) => {
    try {
        const { categoryId, diseaseId, categorySlug } = req.query;
        const query = { isActive: true };

        if (categoryId) {
            query.categoryId = categoryId;
        } else if (categorySlug) {
            const cat = await SubscriptionCategory.findOne({ slug: categorySlug.toLowerCase() });
            if (cat) query.categoryId = cat._id;
        }

        if (diseaseId) {
            query.diseaseIds = diseaseId;
        }

        const plans = await SubscriptionPlan.find(query)
            .populate('categoryId', 'name slug iconImage isDiseaseSpecific')
            .populate('diseaseIds', 'name slug iconImage')
            .sort({ price: 1 })
            .lean();

        // 🌟 Add helpful UI flags
        const formattedPlans = plans.map(p => ({
            ...p,
            codBadge: "✔ Instant COD Unlocked for All Bookings",
            isCodGuaranteed: true
        }));

        res.json({ success: true, count: formattedPlans.length, data: formattedPlans });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. BUY SUBSCRIPTION
const purchaseSubscription = async (req, res) => {
    try {
        const { planId } = req.body;
        const userId = req.user.id;

        const plan = await SubscriptionPlan.findById(planId)
            .populate('categoryId', 'name')
            .populate('diseaseIds', 'name');

        if (!plan || !plan.isActive) {
            return res.status(404).json({ success: false, message: "Subscription plan not found or inactive." });
        }

        const existingActive = await UserSubscription.findOne({
            userId,
            status: 'Active',
            endDate: { $gt: new Date() }
        });

        if (existingActive) {
            return res.status(400).json({ 
                success: false, 
                message: "You already have an active subscription. Enjoy your VIP benefits and unlimited COD access." 
            });
        }

        const tempOrderId = `SUB-${Date.now().toString().slice(-6)}`;
        const rzpOrder = await createRazorpayOrder(plan.price, `receipt_${tempOrderId}`);

        const startDate = new Date();
        const endDate = moment(startDate).add(plan.validityInDays, 'days').toDate();

        const draftSubscription = await UserSubscription.create({
            userId,
            planId,
            startDate,
            endDate,
            remainingBenefits: {
                freeDoctorAppointmentsCount: plan.benefits.freeDoctorAppointmentsCount,
                freeNurseVisitsCount: plan.benefits.freeNurseVisitsCount,
                freeLabDeliveriesCount: plan.benefits.freeLabDeliveriesCount,
                freeNurseDeliveriesCount: plan.benefits.freeNurseDeliveriesCount,
                freePharmacyDeliveriesCount: plan.benefits.freePharmacyDeliveriesCount,
                freeAmbulanceTripsCount: plan.benefits.freeAmbulanceTripsCount
            },
            status: 'Pending',
            paymentStatus: 'Pending',
            razorpayOrderId: rzpOrder.id
        });

        res.status(201).json({
            success: true,
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount,
            razorpayOrderId: rzpOrder.id,
            subscriptionId: draftSubscription._id,
            planDetails: {
                name: plan.name,
                category: plan.categoryId?.name || "",
                coveredDiseases: plan.diseaseIds.map(d => d.name),
                price: plan.price,
                validityInDays: plan.validityInDays,
                unlimitedCod: true
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 5. VERIFY PAYMENT & ACTIVATE
const verifySubscriptionPayment = async (req, res) => {
    try {
        const { subscriptionId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

        if (!subscriptionId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(400).json({ success: false, message: "Missing payment tokens." });
        }

        const isVerified = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        if (!isVerified) {
            return res.status(400).json({ success: false, message: "Signature verification failed." });
        }

        const rzpDetails = await fetchAndMapRazorpayPayment(razorpayPaymentId, razorpaySignature);

        const subscription = await UserSubscription.findByIdAndUpdate(
            subscriptionId,
            {
                $set: {
                    status: 'Active',
                    paymentStatus: 'Paid',
                    razorpayPaymentId,
                    razorpaySignature,
                    paymentDetails: rzpDetails
                }
            },
            { new: true }
        ).populate({
            path: 'planId',
            populate: [{ path: 'categoryId' }, { path: 'diseaseIds' }]
        });

        res.json({
            success: true,
            message: "VIP Subscription Activated! You now have Unlimited COD Access on all healthcare bookings.",
            data: subscription
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 6. GET ACTIVE USER STATUS (Shows COD Access Badge)
const getMyActiveSubscription = async (req, res) => {
    try {
        const activeSub = await UserSubscription.findOne({
            userId: req.user.id,
            status: 'Active',
            endDate: { $gt: new Date() }
        }).populate({
            path: 'planId',
            populate: [
                { path: 'categoryId', select: 'name slug iconImage' },
                { path: 'diseaseIds', select: 'name slug iconImage' }
            ]
        });

        if (!activeSub) {
            return res.json({ 
                success: true, 
                hasActivePlan: false, 
                vipCodAccess: false,
                data: null 
            });
        }

        res.json({
            success: true,
            hasActivePlan: true,
            vipCodAccess: true, // 👈 Frontend can show green VIP badge
            data: activeSub
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getUserCategories,
    getUserDiseasesByCategory,
    getPlans,
    purchaseSubscription,
    verifySubscriptionPayment,
    getMyActiveSubscription
};