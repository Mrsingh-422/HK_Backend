// controllers/admin/others/PolicyConfig.js
const NoShowConfig = require('../../../models/NoShowConfig');
const CancellationConfig = require('../../../models/CancellationConfig');
const CodConfig = require('../../../models/CodConfig');

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


/////////////////////////////////////////////////////////////////////////
//////////////////////// COD CONFIGURATIONS ////////////////////////////
/////////////////////////////////////////////////////////////////////////

// GET: Fetch COD toggle configurations for all 6 vendors
// Endpoint: GET /api/admin/policy-config/cod
const getCodConfigs = async (req, res) => {
    try {
        const configs = await CodConfig.find();
        
        // Return active list of states. If any vendor configuration is missing, default to true
        const allVendors = ['Lab', 'Pharmacy', 'Nurse', 'Hospital', 'Doctor', 'Ambulance'];
        const formattedData = allVendors.map(vendor => {
            const dbMatch = configs.find(c => c.vendorType === vendor);
            return {
                vendorType: vendor,
                isCodAvailable: dbMatch ? dbMatch.isCodAvailable : true
            };
        });

        res.json({ success: true, data: formattedData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST: Toggle COD status for a specific vendor type
// Endpoint: POST /api/admin/policy-config/cod/toggle
const toggleCodStatus = async (req, res) => {
    try {
        const { vendorType, isCodAvailable } = req.body; // isCodAvailable: true | false

        const config = await CodConfig.findOneAndUpdate(
            { vendorType },
            { $set: { isCodAvailable: Boolean(isCodAvailable) } },
            { new: true, upsert: true }
        );

        res.json({
            success: true,
            message: `COD availability for ${vendorType} has been successfully set to ${config.isCodAvailable}`,
            data: config
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getPolicyConfigs, updateNoShowConfig, updateCancellationConfig,
    getCodConfigs, toggleCodStatus
 };