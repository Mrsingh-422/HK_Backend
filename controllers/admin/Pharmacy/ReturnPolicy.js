// controllers/admin/Pharmacy/ReturnPolicy.js
const PharmacyReturnConfig = require('../../../models/PharmacyReturnConfig');

// 1. GET: Fetch Return Policy Settings & T&C
// Endpoint: GET /admin/pharmacy/return-policy (Also used by public/user to view T&C)
const getReturnPolicyConfig = async (req, res) => {
    try {
        let config = await PharmacyReturnConfig.findOne({ vendorType: 'Pharmacy' });
        if (!config) {
            config = await PharmacyReturnConfig.create({ vendorType: 'Pharmacy' });
        }
        res.json({ success: true, data: config });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. PUT: Update Return Policy, Window Days & T&C
// Endpoint: PUT /admin/pharmacy/return-policy/update
const updateReturnPolicyConfig = async (req, res) => {
    try {
        const { returnWindowDays, isReturnEnabled, isReplacementEnabled, allowedReasons, termsAndConditions } = req.body;

        if (returnWindowDays !== undefined && (isNaN(returnWindowDays) || Number(returnWindowDays) < 0)) {
            return res.status(400).json({ success: false, message: "Valid return window days number is required." });
        }

        const updateData = {};
        if (returnWindowDays !== undefined) updateData.returnWindowDays = Number(returnWindowDays);
        if (isReturnEnabled !== undefined) updateData.isReturnEnabled = Boolean(isReturnEnabled);
        if (isReplacementEnabled !== undefined) updateData.isReplacementEnabled = Boolean(isReplacementEnabled);
        if (allowedReasons !== undefined) updateData.allowedReasons = allowedReasons;
        if (termsAndConditions !== undefined) updateData.termsAndConditions = termsAndConditions.trim();

        const config = await PharmacyReturnConfig.findOneAndUpdate(
            { vendorType: 'Pharmacy' },
            { $set: updateData },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            message: "Pharmacy Return & Replacement Policy and T&C updated successfully!",
            data: config
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getReturnPolicyConfig,
    updateReturnPolicyConfig
};