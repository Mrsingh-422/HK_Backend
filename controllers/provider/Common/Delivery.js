const DeliveryCharge = require('../../../models/DeliveryCharge');

// 1. SAVE DELIVERY CHARGES
// endpoint: POST /api/provider/common/delivery/save
const saveDeliveryCharges = async (req, res) => {
    try {
        const charges = await DeliveryCharge.findOneAndUpdate(
            { vendorId: req.user.id },
            { $set: req.body },
            { upsert: true, new: true }
        );
        res.json({ success: true, message: "Delivery charges saved", data: charges });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. GET MY DELIVERY CHARGES
// endpoint: GET /api/provider/common/delivery/my-charges
const getMyDeliveryCharges = async (req, res) => {
    try {
        const data = await DeliveryCharge.findOne({ vendorId: req.user.id });
        res.json({ success: true, data });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { saveDeliveryCharges, getMyDeliveryCharges };