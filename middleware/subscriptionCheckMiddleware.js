const UserSubscription = require('../models/UserSubscription');

/**
 * Middleware to restrict specialized disease care bookings to respective subscribers only
 * @param {String} requiredDisease - 'Dementia' | 'Dialysis' | 'Cancer'
 */
const requireConditionPlan = (requiredDisease) => {
    return async (req, res, next) => {
        try {
            const activeSub = await UserSubscription.findOne({
                userId: req.user.id,
                status: 'Active',
                endDate: { $gt: new Date() }
            }).populate('planId');

            // Verification check
            if (!activeSub || activeSub.planId.planType !== 'Condition Management' || activeSub.planId.diseaseType !== requiredDisease) {
                return res.status(403).json({
                    success: false,
                    message: `Access Denied: This specialized service requires an active '${requiredDisease} Care Plan' subscription.`
                });
            }

            next(); // Access granted
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    };
};

module.exports = { requireConditionPlan };