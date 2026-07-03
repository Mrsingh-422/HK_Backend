const SubscriptionPlan = require('../../../models/SubscriptionPlan');
const UserSubscription = require('../../../models/UserSubscription');
const { createRazorpayOrder, verifyRazorpaySignature, fetchAndMapRazorpayPayment } = require('../../../utils/razorpay');
const moment = require('moment');

// 1. GET ALL ACTIVE PLANS
const getPlans = async (req, res) => {
    try {
        const { type } = req.query; // 'Elder Care' or 'Condition Management'
        let query = { isActive: true };
        if (type) query.planType = type;

        const plans = await SubscriptionPlan.find(query).sort({ price: 1 });
        res.json({ success: true, count: plans.length, data: plans });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. INITIATE PURCHASE (Generate Razorpay Order)
const purchaseSubscription = async (req, res) => {
    try {
        const { planId } = req.body;
        const userId = req.user.id;

        const plan = await SubscriptionPlan.findById(planId);
        if (!plan || !plan.isActive) {
            return res.status(404).json({ success: false, message: "Subscription plan not found or inactive." });
        }

        // Active subscription checking
        const existingActive = await UserSubscription.findOne({
            userId,
            status: 'Active',
            endDate: { $gt: new Date() }
        });

        if (existingActive) {
            return res.status(400).json({ 
                success: false, 
                message: "You already have an active subscription." 
            });
        }

        const tempOrderId = `SUB-${Date.now().toString().slice(-6)}`;
        
        // Order value generation
        const rzpOrder = await createRazorpayOrder(plan.price, `receipt_${tempOrderId}`);

        // Set start and end date using validityInDays
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
            amount: rzpOrder.amount, // in paise
            razorpayOrderId: rzpOrder.id,
            subscriptionId: draftSubscription._id,
            planDetails: {
                name: plan.name,
                price: plan.price,
                validityInDays: plan.validityInDays,
                termsAndConditions: plan.termsAndConditions
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. VERIFY PAYMENT & ACTIVATE
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
        ).populate('planId');

        if (!subscription) {
            return res.status(404).json({ success: false, message: "Subscription not found." });
        }

        res.json({
            success: true,
            message: "Subscription activated successfully!",
            data: subscription
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. GET ACTIVE SUBSCRIPTION STATUS
const getMyActiveSubscription = async (req, res) => {
    try {
        const activeSub = await UserSubscription.findOne({
            userId: req.user.id,
            status: 'Active',
            endDate: { $gt: new Date() }
        }).populate('planId');

        if (!activeSub) {
            return res.json({ success: true, hasActivePlan: false, data: null });
        }

        res.json({
            success: true,
            hasActivePlan: true,
            data: activeSub
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getPlans,
    purchaseSubscription,
    verifySubscriptionPayment,
    getMyActiveSubscription
};