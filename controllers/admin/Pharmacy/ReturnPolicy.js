// controllers/admin/Pharmacy/ReturnPolicy.js
const PharmacyReturnConfig = require('../../../models/PharmacyReturnConfig');

// 1. GET: Fetch Return Policy Settings
// Endpoint: GET /admin/pharmacy/return-policy
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

// 2. PUT: Update Return Window Days & Settings
// Endpoint: PUT /admin/pharmacy/return-policy/update
const updateReturnPolicyConfig = async (req, res) => {
    try {
        const { returnWindowDays, isReturnEnabled, isReplacementEnabled, allowedReasons } = req.body;

        if (returnWindowDays !== undefined && (isNaN(returnWindowDays) || Number(returnWindowDays) < 0)) {
            return res.status(400).json({ success: false, message: "Valid return window days number is required." });
        }

        const config = await PharmacyReturnConfig.findOneAndUpdate(
            { vendorType: 'Pharmacy' },
            { 
                $set: { 
                    returnWindowDays: Number(returnWindowDays),
                    isReturnEnabled,
                    isReplacementEnabled,
                    allowedReasons
                } 
            },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            message: `Pharmacy return window updated to ${config.returnWindowDays} days.`,
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