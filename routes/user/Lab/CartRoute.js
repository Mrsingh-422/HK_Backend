const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { addToLabCart, getMyCart, clearLabCart, removeItem, updateCartQuantity,
    compareCartOnMap,
    addToPharmacyCart,
    updatePharmacyQuantity,checkBetterOptions,
    getAvailableSlots,
    getAvailableCoupons

 } = require('../../../controllers/user/Lab/Cart');

// Base URL: /user/cart

router.get('/', protect('user'), getMyCart);
router.post('/lab/add', protect('user'), addToLabCart);
router.post('/lab/clear', protect('user'), clearLabCart);
router.delete('/item/:itemId', protect('user'), removeItem);
router.put('/quantity', protect('user'), updateCartQuantity);

router.post('/compare', protect('user'), compareCartOnMap);


// pharmcacy
// Pharmacy Cart Endpoints
router.post('/pharmacy/add', protect('user'), addToPharmacyCart);
router.put('/pharmacy/quantity', protect('user'), updatePharmacyQuantity);
router.post('/check-better-options', protect('user'), checkBetterOptions);




router.get('/available-slots', protect('user'), getAvailableSlots);
router.get('/available-coupons', protect('user'), getAvailableCoupons);

module.exports = router; 