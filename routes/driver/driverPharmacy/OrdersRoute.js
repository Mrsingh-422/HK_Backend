const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getDriverOrders, 
    getOrderDetail, 
    respondToOrder, 
    updateProgress, 
    verifyOtpAndDeliver, 
    reportDeliveryIssue,
    toggleDriverStatus,
    reassignOrderDueToEmergency
} = require('../../../controllers/driver/driverPharmacy/Orders');

// Base URL: /driver/pharmacy/orders

router.get('/list', protect('driver'), getDriverOrders);
router.get('/detail/:orderId', protect('driver'), getOrderDetail);
router.post('/respond', protect('driver'), respondToOrder);
router.patch('/update-progress', protect('driver'), updateProgress);
router.post('/verify-otp', protect('driver'), verifyOtpAndDeliver);
router.post('/report-issue', protect('driver'), reportDeliveryIssue);
router.patch('/toggle-status', protect('driver'), toggleDriverStatus);
router.post('/reassign-emergency', protect('driver'), reassignOrderDueToEmergency);

module.exports = router;