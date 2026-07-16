// controllers/admin/others/PolicyConfig.js
const NoShowConfig = require('../../models/NoShowConfig');
const CancellationConfig = require('../../models/CancellationConfig');

// 1. Fetch all configurations for No-Show and Cancellations
const getPolicyConfigs = async (req, res) => {
    try {
        const noShow = await NoShowConfig.find();
        const cancellation = await CancellationConfig.find();
        
        res.json({
            success: true,
            data: { noShow, cancellation }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. Update or Upsert No-Show configurations
const updateNoShowConfig = async (req, res) => {
    try {
        const { vendorType, chargeType, chargeValue, timePeriodInMinutes, triggerState, isActive } = req.body;

        const config = await NoShowConfig.findOneAndUpdate(
            { vendorType },
            { 
                $set: { 
                    chargeType, 
                    chargeValue: Number(chargeValue || 0), 
                    timePeriodInMinutes: timePeriodInMinutes ? Number(timePeriodInMinutes) : null,
                    triggerState: triggerState || null,
                    isActive: isActive ?? true
                } 
            },
            { new: true, upsert: true }
        );

        res.json({ success: true, message: "No-Show policy updated", data: config });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. Update or Upsert Cancellation configurations
const updateCancellationConfig = async (req, res) => {
    try {
        const { vendorType, chargeType, chargeValue, isActive } = req.body;

        const config = await CancellationConfig.findOneAndUpdate(
            { vendorType },
            { 
                $set: { 
                    chargeType, 
                    chargeValue: Number(chargeValue || 0), 
                    isActive: isActive ?? true
                } 
            },
            { new: true, upsert: true }
        );

        res.json({ success: true, message: "Cancellation policy updated", data: config });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getPolicyConfigs, updateNoShowConfig, updateCancellationConfig };