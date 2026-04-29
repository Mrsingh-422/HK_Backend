const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getDriverOrders, 
    respondToOrder, 
    updateProgress, 
    verifySampleCollection 
} = require('../../../controllers/driver/driverLab/LabDriverOrders');

// Base URL: /driver/lab/orders

router.get('/orders', protect('driver'), getDriverOrders);
router.patch('/respond/:orderId', protect('driver'), respondToOrder);
router.patch('/update-progress/:orderId', protect('driver'), updateProgress);
router.post('/verify-otp', protect('driver'), verifySampleCollection);

module.exports = router;