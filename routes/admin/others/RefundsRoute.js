const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware.js'); 
const { getRefundInitiatedList, processAdminRefund } = require('../../../controllers/admin/others/Refunds');

// Base route: /api/admin/refunds

// 1. GET: Fetch all bookings requiring a refund across all 5 models (Paginated)
router.get('/', protect('admin'), getRefundInitiatedList);

// 2. POST: Execute a programmatic Razorpay refund
router.post('/process', protect('admin'), processAdminRefund);

module.exports = router;