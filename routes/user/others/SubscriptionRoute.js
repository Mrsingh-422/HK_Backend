const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getPlans, 
    purchaseSubscription, 
    verifySubscriptionPayment, 
    getMyActiveSubscription 
} = require('../../../controllers/user/others/SubscriptionController');

// Base URL: /user/subscriptions

// User Endpoints
router.get('/list', getPlans);
router.get('/my-status', protect('user'), getMyActiveSubscription);
router.post('/buy', protect('user'), purchaseSubscription);
router.post('/verify-payment', protect('user'), verifySubscriptionPayment);

module.exports = router;