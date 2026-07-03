const SubscriptionPlan = require('../../../models/SubscriptionPlan');

const createSubscriptionPlanByAdmin = async (req, res) => {
    try {
        const { 
            planType, name, diseaseType, validityInDays, price, 
            description, features, benefits, termsAndConditions 
        } = req.body;

        if (!planType || !name || !validityInDays || price === undefined) {
            return res.status(400).json({ success: false, message: "Required fields are missing." });
        }

        const newPlan = await SubscriptionPlan.create({
            planType,
            name,
            diseaseType: planType === 'Condition Management' ? diseaseType : null,
            validityInDays: Number(validityInDays), // Convert validity to days
            price: Number(price),
            description,
            termsAndConditions: termsAndConditions || "",
            features: Array.isArray(features) ? features : (features ? features.split(',').map(f => f.trim()) : []),
            benefits: {
                freeDoctorAppointmentsCount: Number(benefits?.freeDoctorAppointmentsCount || 0),
                freeNurseVisitsCount: Number(benefits?.freeNurseVisitsCount || 0),
                freeLabDeliveriesCount: Number(benefits?.freeLabDeliveriesCount || 0),
                freeNurseDeliveriesCount: Number(benefits?.freeNurseDeliveriesCount || 0),
                freePharmacyDeliveriesCount: Number(benefits?.freePharmacyDeliveriesCount || 0),
                freeAmbulanceTripsCount: Number(benefits?.freeAmbulanceTripsCount || 0)
            }
        });

        res.status(201).json({ success: true, message: "Subscription plan created.", data: newPlan });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateSubscriptionPlanByAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { planType, name, diseaseType, validityInDays, price, description, features, benefits, isActive, termsAndConditions } = req.body;

        const updateData = {};
        if (planType) updateData.planType = planType;
        if (name) updateData.name = name;
        updateData.diseaseType = planType === 'Condition Management' ? diseaseType : null;
        if (validityInDays !== undefined) updateData.validityInDays = Number(validityInDays);
        if (price !== undefined) updateData.price = Number(price);
        if (description !== undefined) updateData.description = description;
        if (termsAndConditions !== undefined) updateData.termsAndConditions = termsAndConditions;
        if (isActive !== undefined) updateData.isActive = isActive;
        
        if (features) {
            updateData.features = Array.isArray(features) ? features : features.split(',').map(f => f.trim());
        }

        if (benefits) {
            updateData.benefits = {
                freeDoctorAppointmentsCount: Number(benefits.freeDoctorAppointmentsCount ?? 0),
                freeNurseVisitsCount: Number(benefits.freeNurseVisitsCount ?? 0),
                freeLabDeliveriesCount: Number(benefits.freeLabDeliveriesCount ?? 0),
                freeNurseDeliveriesCount: Number(benefits.freeNurseDeliveriesCount ?? 0),
                freePharmacyDeliveriesCount: Number(benefits.freePharmacyDeliveriesCount ?? 0),
                freeAmbulanceTripsCount: Number(benefits.freeAmbulanceTripsCount ?? 0)
            };
        }

        const updatedPlan = await SubscriptionPlan.findByIdAndUpdate(id, { $set: updateData }, { new: true });
        res.json({ success: true, message: "Subscription plan updated.", data: updatedPlan });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// 3. DELETE/TOGGLE PLAN (Optional Helper)
const deleteSubscriptionPlanByAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const deletedPlan = await SubscriptionPlan.findByIdAndDelete(id);
        if (!deletedPlan) return res.status(404).json({ success: false, message: "Plan not found." });
        res.json({ success: true, message: "Plan deleted successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = { createSubscriptionPlanByAdmin, updateSubscriptionPlanByAdmin, deleteSubscriptionPlanByAdmin };