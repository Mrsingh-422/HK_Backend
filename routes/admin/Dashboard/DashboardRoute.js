// routes/admin/Dashboard/DashboardRoute.js

const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    getDashboardOrderStats, 
    getLiveOrdersFeed ,
    getOrderDetail,getAdminDashboardStats
} = require('../../../controllers/admin/Dashboard/Dashboard');

// Base URL: /admin/dashboard

// Summary cards details (Lab, Pharmacy, Nurse, Hospital, Ambulance)
router.get('/order-stats', protect('admin'),checkRoleAccess(5), getDashboardOrderStats);

// Live Orders Feed list with pagination
router.get('/live-feed', protect('admin'), checkRoleAccess(5), getLiveOrdersFeed);

// --- NAYA DYNAMIC DETAIL ROUTE ---
router.get('/order-details/:id', protect('admin'), checkRoleAccess(5), getOrderDetail);

router.get('/stats', protect('admin'), checkRoleAccess(5), getAdminDashboardStats);


module.exports = router;