const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { createCoupon, getMyCoupons } = require('../../../controllers/provider/Common/Coupon'); // Apna Coupon controller import karein

// Route: POST /provider/promotions/coupon

router.post('/promotions/coupon', protect('provider'), createCoupon);
router.get('/promotions/coupons', protect('provider'), getMyCoupons);

module.exports = router;