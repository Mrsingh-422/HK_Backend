const express = require('express');
const router = express.Router();
const { 
    createSubscriptionPlanByAdmin,
    updateSubscriptionPlanByAdmin,
    deleteSubscriptionPlanByAdmin
} = require('../../../controllers/admin/others/AdminSubscription');

// Base URL: /admin/subscriptions
router.post('/create', createSubscriptionPlanByAdmin);
router.put('/update/:id', updateSubscriptionPlanByAdmin);
router.delete('/delete/:id', deleteSubscriptionPlanByAdmin);

module.exports = router;