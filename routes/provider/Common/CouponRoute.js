const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    createCoupon, 
    getMyCoupons, 
    createAdminCoupon, 
    toggleCoupon, 
    deleteCoupon 
} = require('../../../controllers/provider/Common/Coupon');

// Base URL: /provider/coupons

// --- Vendor Routes ---
router.post('/add', protect('provider'), createCoupon);
router.get('/list', protect('provider'), getMyCoupons);
router.patch('/toggle/:id', protect('provider'), toggleCoupon);
router.delete('/delete/:id', protect('provider'), deleteCoupon);

// --- Admin Route ---
router.post('/admin/add', protect('admin'), createAdminCoupon); 

module.exports = router;