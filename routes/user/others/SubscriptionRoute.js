const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getUserCategories,
    getUserDiseasesByCategory,
    getPlans, 
    purchaseSubscription, 
    verifySubscriptionPayment, 
    getMyActiveSubscription 
} = require('../../../controllers/user/others/SubscriptionController');

// Base URL: /user/subscriptions
router.get('/categories', getUserCategories);
router.get('/diseases', getUserDiseasesByCategory);
router.get('/list', getPlans);

router.get('/my-status', protect('user'), getMyActiveSubscription);
router.post('/buy', protect('user'), purchaseSubscription);
router.post('/verify-payment', protect('user'), verifySubscriptionPayment);

module.exports = router;