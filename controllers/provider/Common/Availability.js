// controllers/provider/Common/Availability.js
const Availability = require('../../../models/Availability');

// 1. SET SLOTS
// endpoint: POST /api/provider/common/set-slots
const setSlots = async (req, res) => {
    try {
        const slots = await Availability.findOneAndUpdate({ vendorId: req.user.id }, { $set: req.body }, { upsert: true, new: true });
        res.json({ success: true, data: slots });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. GET SLOTS
// endpoint: GET /api/provider/common/my-slots
const getMySlots = async (req, res) => {
    try {
        const slots = await Availability.findOne({ vendorId: req.user.id });
        res.json({ success: true, data: slots });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { setSlots, getMySlots };