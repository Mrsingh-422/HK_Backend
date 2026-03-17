const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getLabStats,updateProgressStatus, handleOrderAction,  uploadReport,
} = require('../../../controllers/provider/Lab/LabsOrder'); // Apna LabOrderController import karein

// Base URL: /provider/labs

// Lab Operations
router.get('/dashboard', protect('provider'), getLabStats);
router.patch('/order-action/:orderId', protect('Lab'), handleOrderAction);

router.patch('/update-progress/:orderId', protect('Lab'), updateProgressStatus);
router.post('/upload-report/:orderId', protect('Lab'), uploadReport);

module.exports = router;