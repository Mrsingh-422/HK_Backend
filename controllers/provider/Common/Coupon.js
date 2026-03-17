// controllers/provider/Common/Coupon.js
const Coupon = require('../../../models/Coupon');

// 1. CREATE COUPON
// endpoint: POST /api/provider/common/coupons/add
const createCoupon = async (req, res) => {
    try {
        const coupon = await Coupon.create({ vendorId: req.user.id, vendorType: req.user.category, ...req.body });
        res.json({ success: true, data: coupon });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. LIST MY COUPONS
// endpoint: GET /api/provider/common/coupons/list
const getMyCoupons = async (req, res) => {
    try {
        const list = await Coupon.find({ vendorId: req.user.id });
        res.json({ success: true, data: list });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { createCoupon, getMyCoupons };