// utils/subscriptionBenefitHelper.js
const UserSubscription = require('../models/UserSubscription');

/**
 * Checks if the user has an active plan and remaining benefits for a specific service
 */
const checkAndApplyBenefit = async (userId, benefitField, originalAmount) => {
    try {
        if (!userId) return { amount: originalAmount, isApplied: false };
        
        const activeSub = await UserSubscription.findOne({
            userId,
            status: 'Active',
            endDate: { $gt: new Date() }
        });

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

/**
 * Refunds benefit count on cancellation
 */
const refundBenefitCount = async (userId, benefitField) => {
    try {
        if (!userId) return false;
        
        const activeSub = await UserSubscription.findOne({
            userId,
            status: 'Active',
            endDate: { $gt: new Date() }
        });

        if (activeSub) {
            activeSub.remainingBenefits[benefitField] += 1;
            await activeSub.save();
            return true;
        }
        return false;
    } catch (error) {
        console.error(`Benefit refund error for ${benefitField}:`, error);
        return false;
    }
};

/**
 * 🚀 Updated: Deeply populates Category & Multi-Disease metadata for User Profile API
 */
const getActiveSubscriptionMetadata = async (userId) => {
    try {
        if (!userId) return null;

        const activeSub = await UserSubscription.findOne({
            userId,
            status: 'Active',
            endDate: { $gt: new Date() }
        }).populate({
            path: 'planId',
            populate: [
                { path: 'categoryId', select: 'name slug iconImage' },
                { path: 'diseaseIds', select: 'name slug iconImage' }
            ]
        });

        if (!activeSub || !activeSub.planId) return null;

        return {
            subscriptionId: activeSub._id,
            planName: activeSub.planId.name,
            category: activeSub.planId.categoryId?.name || "General Care",
            coveredDiseases: activeSub.planId.diseaseIds ? activeSub.planId.diseaseIds.map(d => d.name) : [],
            endDate: activeSub.endDate,
            unlimitedCodAccess: true, // 👈 Frontend badge flag
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