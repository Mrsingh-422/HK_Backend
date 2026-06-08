// routes/admin/Dashboard/DashboardRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getDashboardOrderStats, 
    getLiveOrdersFeed ,
    getOrderDetail
} = require('../../../controllers/admin/Dashboard/Dashboard');

// Base URL: /admin/dashboard

// Summary cards details (Lab, Pharmacy, Nurse, Hospital, Ambulance)
router.get('/order-stats', protect('admin'), getDashboardOrderStats);

// Live Orders Feed list with pagination
router.get('/live-feed', protect('admin'), getLiveOrdersFeed);

// --- NAYA DYNAMIC DETAIL ROUTE ---
router.get('/order-details/:id', protect('admin'), getOrderDetail);


module.exports = router;