const VendorKMLimit = require('../../../models/VendorKMLimit');

// Set or Update KM Limit for a Vendor Type
const setVendorKMLimit = async (req, res) => {
    try {
        const { vendorType, kmLimit, isActive } = req.body;

        // update if exists, else create (Upsert)
        const config = await VendorKMLimit.findOneAndUpdate(
            { vendorType },
            { kmLimit, isActive },
            { new: true, upsert: true }
        );

        res.json({ success: true, message: `${vendorType} limit set to ${kmLimit} KM`, data: config });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Get All Configs
const getVendorKMLimits = async (req, res) => {
    try {
        const configs = await VendorKMLimit.find();
        res.json({ success: true, data: configs });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { setVendorKMLimit, getVendorKMLimits };