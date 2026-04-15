const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { getPharmacyOrders, updateOrderStatus } = require('../../../controllers/provider/Pharmacy/PharmacyOrders');

// Base URL: /provider/pharmacy/orders

router.get('/list', protect('pharmacy'), getPharmacyOrders);
router.patch('/update-status/:orderId', protect('pharmacy'), updateOrderStatus);

module.exports = router;