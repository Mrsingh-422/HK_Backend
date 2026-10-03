const mongoose = require('mongoose');
const SubscriptionCategory = require('../../../models/SubscriptionCategory');
const SubscriptionDisease = require('../../../models/SubscriptionDisease');
const SubscriptionPlan = require('../../../models/SubscriptionPlan');
const UserSubscription = require('../../../models/UserSubscription');
const User = require('../../../models/User');
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

// VERIFY SUBSCRIPTION PAYMENT (Universal Parameter Support & VIP Status Activation)
// endpoint: POST /user/subscriptions/verify-payment
const verifySubscriptionPayment = async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Universal Body Resolver
        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) {}
        }
        if (body.response && typeof body.response === 'object') {
            body = { ...body, ...body.response };
        }
        if (body.data && typeof body.data === 'object') {
            body = { ...body, ...body.data };
        }
        if (body.paymentDetails && typeof body.paymentDetails === 'object') {
            body = { ...body, ...body.paymentDetails };
        }

        const rzpPaymentId = body.razorpay_payment_id || 
                             body.razorpayPaymentId || 
                             body.paymentId || 
                             body.payment_id;

        const rzpOrderId = body.razorpay_order_id || 
                           body.razorpayOrderId || 
                           body.orderId || 
                           body.order_id;

        const rzpSignature = body.razorpay_signature || 
                             body.razorpaySignature || 
                             body.signature;

        const targetSubId = body.subscriptionId || 
                            body.subscriptionMongoId || 
                            body.id;

        if (!rzpPaymentId) {
            return res.status(400).json({ 
                success: false, 
                message: "Missing razorpayPaymentId / razorpay_payment_id parameter." 
            });
        }

        // 2. Signature Verification
        let isVerified = false;
        if (rzpOrderId && rzpSignature) {
            isVerified = verifyRazorpaySignature(rzpOrderId, rzpPaymentId, rzpSignature);
        }

        if (!isVerified && (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV)) {
            console.warn("⚠️ [DEV NOTICE]: Subscription signature mismatch bypassed in development mode.");
            isVerified = true;
        }

        if (!isVerified && process.env.NODE_ENV === 'production') {
            return res.status(400).json({ 
                success: false, 
                message: "Signature verification failed. Invalid transaction signature." 
            });
        }

        // 3. Dynamic Subscription Document Lookup
        const searchConditions = [];
        if (targetSubId && mongoose.isValidObjectId(targetSubId)) {
            searchConditions.push({ _id: targetSubId });
        }
        if (rzpOrderId) {
            searchConditions.push({ razorpayOrderId: rzpOrderId });
        }

        let subscription = null;
        if (searchConditions.length > 0) {
            subscription = await UserSubscription.findOne({ 
                userId, 
                $or: searchConditions 
            });
        }

        if (!subscription) {
            // Fallback: Check most recent pending subscription for this user
            subscription = await UserSubscription.findOne({
                userId,
                status: 'Pending',
                paymentStatus: 'Pending'
            }).sort({ createdAt: -1 });
        }

        if (!subscription) {
            return res.status(404).json({ 
                success: false, 
                message: "Subscription record not found or access denied." 
            });
        }

        // 4. Map Payment Details
        let rzpDetails = null;
        try {
            if (rzpSignature) {
                rzpDetails = await fetchAndMapRazorpayPayment(rzpPaymentId, rzpSignature);
            }
        } catch (fetchErr) {}

        if (!rzpDetails) {
            rzpDetails = {
                razorpayPaymentId: rzpPaymentId,
                razorpayOrderId: rzpOrderId || "",
                razorpaySignature: rzpSignature || "",
                method: 'Online',
                status: 'captured',
                paidAt: new Date()
            };
        }

        subscription.status = 'Active';
        subscription.paymentStatus = 'Paid';
        subscription.razorpayPaymentId = rzpPaymentId;
        subscription.razorpaySignature = rzpSignature || "";
        subscription.paymentDetails = rzpDetails;
        await subscription.save();

        const populatedSub = await UserSubscription.findById(subscription._id).populate({
            path: 'planId',
            populate: [
                { path: 'categoryId', select: 'name slug iconImage' },
                { path: 'diseaseIds', select: 'name slug iconImage' }
            ]
        });

        res.status(200).json({
            success: true,
            message: "VIP Subscription Activated! You now have Unlimited COD Access on all healthcare bookings.",
            data: populatedSub
        });

    } catch (error) {
        console.error("Verify Subscription Payment Error:", error);
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