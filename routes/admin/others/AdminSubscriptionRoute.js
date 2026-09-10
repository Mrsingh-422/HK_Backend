const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    createCategory,
    getCategories,
    updateCategory,
    deleteCategory,
    createDisease,
    getDiseases,
    updateDisease,
    deleteDisease,
    createSubscriptionPlanByAdmin,
    getAllSubscriptionPlansByAdmin,
    getSubscriptionPlanByIdByAdmin,
    updateSubscriptionPlanByAdmin,
    deleteSubscriptionPlanByAdmin,
    getAllSubscribersForAdmin,
    getSubscriberDetailForAdmin
} = require('../../../controllers/admin/others/AdminSubscription');

// Base URL: /admin/subscriptions

// 1. Categories
router.post('/categories', protect('admin'), createCategory);
router.get('/categories', protect('admin'), getCategories);
router.put('/categories/:id', protect('admin'), updateCategory);
router.delete('/categories/:id', protect('admin'), deleteCategory);

// 2. Diseases
router.post('/diseases', protect('admin'), createDisease);
router.get('/diseases', protect('admin'), getDiseases);
router.put('/diseases/:id', protect('admin'), updateDisease);
router.delete('/diseases/:id', protect('admin'), deleteDisease);

// 3. Plans
router.post('/plans/create', protect('admin'), createSubscriptionPlanByAdmin);
router.get('/plans', protect('admin'), getAllSubscriptionPlansByAdmin);
router.get('/plans/:id', protect('admin'), getSubscriptionPlanByIdByAdmin);
router.put('/plans/:id', protect('admin'), updateSubscriptionPlanByAdmin);
router.delete('/plans/:id', protect('admin'), deleteSubscriptionPlanByAdmin);

// 4. Subscribers Queue (Fixed)
router.get('/subscribers', protect('admin'), getAllSubscribersForAdmin);
router.get('/subscribers/:id', protect('admin'), getSubscriberDetailForAdmin);

module.exports = router;