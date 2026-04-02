const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    createCoupon, 
    getMyCoupons, 
    createAdminCoupon, 
    toggleCoupon, 
    deleteCoupon ,getCouponEnumTypes ,getAdminCoupons, toggleAdminCoupon, deleteAdminCoupon, updateAdminCoupon, updateCoupon,
} = require('../../../controllers/provider/Common/Coupon');

// Base URL: /provider/coupons

// --- Vendor Routes ---
router.post('/add', protect('provider'), createCoupon);
router.get('/list', protect('provider'), getMyCoupons);
router.patch('/toggle/:id', protect('provider'), toggleCoupon);
router.put('/update/:id', protect('provider'), updateCoupon);
router.delete('/delete/:id', protect('provider'), deleteCoupon);


// Public route
router.get('/enum-types', getCouponEnumTypes);
// --- Admin Route ---
router.post('/admin/add', protect('admin'), createAdminCoupon); 
router.get('/admin/list', protect('admin'), getAdminCoupons);
router.patch('/admin/toggle/:id', protect('admin'), toggleAdminCoupon);
router.put('/admin/update/:id', protect('admin'), updateAdminCoupon);
router.delete('/admin/delete/:id', protect('admin'), deleteAdminCoupon); 



module.exports = router;