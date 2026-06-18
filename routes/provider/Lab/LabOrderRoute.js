// routes/provider/Lab/labsOrder.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { labDocUploads } = require('../../../middleware/multer'); 
const { 
    getLabStats, 
    getOrders, 
    handleOrderAction, 
    assignStaff, 
    updateProgressStatus, 
    uploadReport 
} = require('../../../controllers/provider/Lab/LabsOrder');

// Base URL: /provider/labs

// Get statistics for dashboard
router.get('/dashboard', protect('provider'), getLabStats);

// Get orders list (supports status & priority filters)
router.get('/orders', protect('provider'), getOrders); 

// Accept/Reject booking
router.patch('/order-action/:orderId', protect('provider'), handleOrderAction);

// Assign staff / phlebotomist
router.patch('/assign-staff/:orderId', protect('provider'), assignStaff);

// Update testing status
router.patch('/update-progress/:orderId', protect('provider'), updateProgressStatus);

// Upload report PDF
router.post('/upload-report/:orderId', protect('provider'), labDocUploads, uploadReport);

module.exports = router;