const UserSubscription = require('../models/UserSubscription');

/**
 * Dynamic Middleware to restrict specialized disease care bookings
 * If no hardcoded parameter is passed, it reads from URL req.params.diseaseType
 */
const requireConditionPlan = (diseaseParam) => {
    return async (req, res, next) => {
        try {
            // Read from function parameter OR fallback to URL parameter (:diseaseType)
            const requiredDisease = diseaseParam || req.params.diseaseType;

            if (!requiredDisease) {
                return res.status(400).json({ success: false, message: "Disease focus type parameter is missing." });
            }

            const activeSub = await UserSubscription.findOne({
                userId: req.user.id,
                status: 'Active',
                endDate: { $gt: new Date() }
            }).populate('planId');

            // Dynamic evaluation
            if (!activeSub || activeSub.planId.planType !== 'Condition Management' || activeSub.planId.diseaseType !== requiredDisease) {
                return res.status(403).json({
                    success: false,
                    message: `Access Denied: This specialized service requires an active '${requiredDisease} Care Plan' subscription.`
                });
            }

            next();
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    };
};

module.exports = { requireConditionPlan };