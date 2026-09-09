// middleware/subscriptionMiddleware.js
const UserSubscription = require('../models/UserSubscription');

/**
 * Dynamic Middleware to restrict specialized condition care bookings
 * Checks if user has an active subscription covering the required disease
 */
const requireConditionPlan = (diseaseIdentifierParam) => {
    return async (req, res, next) => {
        try {
            const rawTarget = diseaseIdentifierParam || req.params.diseaseType || req.query.diseaseType;

            if (!rawTarget) {
                return res.status(400).json({ 
                    success: false, 
                    message: "Disease focus identifier parameter is missing." 
                });
            }

            // Fetch active user subscription and deeply populate Category and Multiple Diseases
            const activeSub = await UserSubscription.findOne({
                userId: req.user.id,
                status: 'Active',
                endDate: { $gt: new Date() }
            }).populate({
                path: 'planId',
                populate: [
                    { path: 'categoryId' },
                    { path: 'diseaseIds' } // 👈 Populates Array of Diseases
                ]
            });

            if (!activeSub || !activeSub.planId) {
                return res.status(403).json({
                    success: false,
                    message: `Access Denied: You need an active Specialized Care Plan subscription to book this service.`
                });
            }

            const plan = activeSub.planId;
            const targetClean = String(rawTarget).toLowerCase().trim();

            // 🎯 Check across ALL diseaseIds linked to this plan
            const isMatch = Array.isArray(plan.diseaseIds) && plan.diseaseIds.some(disease => 
                String(disease._id) === targetClean ||
                String(disease.slug).toLowerCase() === targetClean ||
                String(disease.name).toLowerCase() === targetClean
            );

            if (!isMatch) {
                return res.status(403).json({
                    success: false,
                    message: `Access Denied: Your active plan '${plan.name}' does not cover this specialized condition.`
                });
            }

            next();
        } catch (error) {
            console.error("Require Condition Plan Error:", error);
            res.status(500).json({ success: false, message: error.message });
        }
    };
};

module.exports = { requireConditionPlan };