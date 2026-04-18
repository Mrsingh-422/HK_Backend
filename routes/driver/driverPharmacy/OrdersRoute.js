const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { getDriverOrders, respondToOrder, updateProgress, verifyOtpAndDeliver, reportDeliveryIssue } = require('../../../controllers/driver/driverPharmacy/Orders');

// Base URL: /driver/pharmacy/orders

router.get('/list', protect('driver'), getDriverOrders);
router.post('/respond', protect('driver'), respondToOrder);
router.patch('/update-progress', protect('driver'), updateProgress);
router.post('/verify-otp', protect('driver'), verifyOtpAndDeliver);
router.post('/report-issue', protect('driver'), reportDeliveryIssue);

module.exports = router;