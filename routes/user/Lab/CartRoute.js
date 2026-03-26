const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { addToLabCart, getMyCart, clearLabCart, removeItem, updateCartQuantity } = require('../../../controllers/user/Lab/Cart');

// Base URL: /user/cart

router.get('/', protect('user'), getMyCart);
router.post('/lab/add', protect('user'), addToLabCart);
router.post('/lab/clear', protect('user'), clearLabCart);
router.delete('/item/:itemId', protect('user'), removeItem);
router.put('/quantity', protect('user'), updateCartQuantity);

module.exports = router;