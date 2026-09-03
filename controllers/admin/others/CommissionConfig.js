// controllers/admin/others/CommissionConfig.js
const AdminCommissionConfig = require('../../../models/AdminCommissionConfig');

// 1. GET ALL COMMISSION CONFIGS
// Endpoint: GET /api/admin/commission-config
const getCommissionConfigs = async (req, res) => {
    try {
        const allVendors = [
            'Doctor', 
            'Hospital', 
            'Lab', 
            'Pharmacy', 
            'Nurse', 
            'Ambulance-Accident', 
            'Ambulance-Medical', 
            'Ambulance-Referral'
        ];

        const existingConfigs = await AdminCommissionConfig.find();

        // Ensure all vendors have a default representation
        const formattedList = allVendors.map(vendor => {
            const match = existingConfigs.find(c => c.vendorType === vendor);
            return match || {
                vendorType: vendor,
                commissionType: 'Percentage',
                percentageValue: 10,
                fixedRupeesValue: 0,
                isActive: true
            };
        });

        res.json({
            success: true,
            data: formattedList
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. UPDATE OR CREATE COMMISSION CONFIG
// Endpoint: POST /api/admin/commission-config/update
const updateCommissionConfig = async (req, res) => {
    try {
        const { vendorType, commissionType, percentageValue, fixedRupeesValue, isActive } = req.body;

        if (!vendorType) {
            return res.status(400).json({ success: false, message: "vendorType is required." });
        }

        const config = await AdminCommissionConfig.findOneAndUpdate(
            { vendorType },
            {
                $set: {
                    commissionType: commissionType || 'Percentage',
                    percentageValue: Number(percentageValue || 0),
                    fixedRupeesValue: Number(fixedRupeesValue || 0),
                    isActive: isActive ?? true
                }
            },
            { new: true, upsert: true }
        );

        res.json({
            success: true,
            message: `Admin Cutoff configuration for ${vendorType} updated successfully!`,
            data: config
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getCommissionConfigs,
    updateCommissionConfig
};