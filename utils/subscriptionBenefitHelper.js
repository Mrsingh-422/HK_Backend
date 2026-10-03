// utils/subscriptionBenefitHelper.js
const UserSubscription = require('../models/UserSubscription');

/**
 * Checks if the user has an active plan and remaining benefits for a specific service
 */
const checkAndApplyBenefit = async (userId, benefitField, originalAmount) => {
    try {
        const fallbackAmount = Number(originalAmount || 0);
        if (!userId) {
            return {
                amount: fallbackAmount,
                isApplied: false,
                hasActiveSubscription: false,
                isBenefitExhausted: false,
                remainingCount: 0,
                subId: null,
                planName: "",
                benefitField
            };
        }

        const activeSub = await UserSubscription.findOne({
            userId,
            status: 'Active',
            endDate: { $gt: new Date() }
        }).populate({
            path: 'planId',
            select: 'name categoryId diseaseIds'
        });

        if (activeSub) {
            const remainingCount = Number(activeSub.remainingBenefits?.[benefitField] || 0);
            const planTitle = activeSub.planId?.name || "Active Care Plan";

            if (remainingCount > 0) {
                return {
                    amount: 0,
                    isApplied: true,
                    hasActiveSubscription: true,
                    isBenefitExhausted: false,
                    remainingCount: remainingCount,
                    subId: activeSub._id,
                    planName: planTitle,
                    benefitField,
                    message: `Free ${benefitField.replace('Count', '')} applied successfully via ${planTitle}.`
                };
            } else {
                // Subscription active hai par is particular benefit ka balance 0 ho chuka hai
                return {
                    amount: fallbackAmount,
                    isApplied: false,
                    hasActiveSubscription: true,
                    isBenefitExhausted: true,
                    remainingCount: 0,
                    subId: activeSub._id,
                    planName: planTitle,
                    benefitField,
                    exhaustedMessage: `Your ${planTitle} quota for free delivery/service has been exhausted. Standard charges have been applied.`
                };
            }
        }

        return {
            amount: fallbackAmount,
            isApplied: false,
            hasActiveSubscription: false,
            isBenefitExhausted: false,
            remainingCount: 0,
            subId: null,
            planName: "",
            benefitField
        };
    } catch (error) {
        console.error(`Benefit evaluation error for ${benefitField}:`, error);
        return {
            amount: Number(originalAmount || 0),
            isApplied: false,
            hasActiveSubscription: false,
            isBenefitExhausted: false,
            remainingCount: 0,
            subId: null,
            planName: "",
            benefitField
        };
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