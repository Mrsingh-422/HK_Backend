const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    createSubscriptionPlanByAdmin,
    updateSubscriptionPlanByAdmin,
    deleteSubscriptionPlanByAdmin,
    getAllSubscribersForAdmin,
    getSubscriberDetailForAdmin
} = require('../../../controllers/admin/others/AdminSubscription');

// Base URL: /admin/subscriptions
router.post('/create', createSubscriptionPlanByAdmin);
router.put('/update/:id', updateSubscriptionPlanByAdmin);
router.delete('/delete/:id', deleteSubscriptionPlanByAdmin);

// --- 2. Subscribed Users / Purchase History Routes (NEW) ---
router.get('/subscribers', protect('admin'), getAllSubscribersForAdmin);
router.get('/subscribers/:id', protect('admin'), getSubscriberDetailForAdmin);


module.exports = router;