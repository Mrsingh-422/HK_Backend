const UserSubscription = require('../models/UserSubscription');

/**
 * Checks if the user has an active plan and remaining benefits for a specific service
 * @param {String} userId - User's MongoDB ID
 * @param {String} benefitField - Benefit field name in the schema
 * @param {Number} originalAmount - Current calculated cost
 */
const checkAndApplyBenefit = async (userId, benefitField, originalAmount) => {
    try {
        if (!userId) return { amount: originalAmount, isApplied: false };
        
        const activeSub = await UserSubscription.findOne({
            userId,
            status: 'Active',
            endDate: { $gt: new Date() }
        });

        // If active subscription exists and count is greater than 0
        if (activeSub && activeSub.remainingBenefits[benefitField] > 0) {
            return { amount: 0, isApplied: true, subId: activeSub._id };
        }
        return { amount: originalAmount, isApplied: false };
    } catch (error) {
        console.error(`Benefit evaluation error for ${benefitField}:`, error);
        return { amount: originalAmount, isApplied: false };
    }
};

/**
 * Decrements the count by 1 when booking is confirmed/paid
 * @param {String} userId - User's MongoDB ID
 * @param {String} benefitField - Benefit field name to decrement
 */
const deductBenefitCount = async (userId, benefitField) => {
    try {
        if (!userId) return false;
        
        const activeSub = await UserSubscription.findOne({
            userId,
            status: 'Active',
            endDate: { $gt: new Date() }
        });

        if (activeSub && activeSub.remainingBenefits[benefitField] > 0) {
            activeSub.remainingBenefits[benefitField] -= 1;
            await activeSub.save();
            return true;
        }
        return false;
    } catch (error) {
        console.error(`Benefit decrement error for ${benefitField}:`, error);
        return false;
    }
};


const refundBenefitCount = async (userId, benefitField) => {
    try {
        if (!userId) return false;
        
        const activeSub = await UserSubscription.findOne({
            userId,
            status: 'Active',
            endDate: { $gt: new Date() }
        });

        if (activeSub) {
            // Increment the benefit count back by 1
            activeSub.remainingBenefits[benefitField] += 1;
            await activeSub.save();
            console.log(`[Subscription Refund]: Refunded 1 unit of '${benefitField}' to user: ${userId}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error(`Benefit refund error for ${benefitField}:`, error);
        return false;
    }
};

const getActiveSubscriptionMetadata = async (userId) => {
    try {
        if (!userId) return null;

        const activeSub = await UserSubscription.findOne({
            userId,
            status: 'Active',
            endDate: { $gt: new Date() }
        }).populate('planId', 'name planType validityInDays');

        if (!activeSub) return null;

        return {
            subscriptionId: activeSub._id,
            planName: activeSub.planId?.name || "Premium Care Plan",
            planType: activeSub.planId?.planType || "Elder Care",
            endDate: activeSub.endDate,
            remainingBenefits: activeSub.remainingBenefits
        };
    } catch (error) {
        console.error("Error populating subscription metadata:", error);
        return null;
    }
};

module.exports = {
    checkAndApplyBenefit,
    deductBenefitCount,
    refundBenefitCount,
    getActiveSubscriptionMetadata
};