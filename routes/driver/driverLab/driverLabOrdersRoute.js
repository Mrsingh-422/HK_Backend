const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getDriverOrders, 
    getOrderDetail,
    respondToOrder, 
    reachLocation,
    verifySampleCollection,
    updateProgress,
    reportCollectionIssue,
    toggleDriverStatus,
    reassignLabOrderDueToEmergency // 🌟 सिंक किया गया
} = require('../../../controllers/driver/driverLab/LabDriverOrders');

// Base URL: /driver/lab/orders

router.get('/orders', protect('driver'), getDriverOrders);
router.get('/detail/:bookingId', protect('driver'), getOrderDetail);
router.patch('/respond/:orderId', protect('driver'), respondToOrder);
router.patch('/arrive/:orderId', protect('driver'), reachLocation);
router.post('/verify-otp', protect('driver'), verifySampleCollection);
router.patch('/update-progress/:orderId', protect('driver'), updateProgress);
router.post('/report-issue/:orderId', protect('driver'), reportCollectionIssue);
router.patch('/toggle-status', protect('driver'), toggleDriverStatus);
router.post('/reassign-emergency', protect('driver'), reassignLabOrderDueToEmergency); // 🌟 एंडपॉइंट जोड़ा गया

module.exports = router;