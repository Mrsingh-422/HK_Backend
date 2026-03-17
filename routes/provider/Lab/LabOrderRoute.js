const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getLabStats,updateProgressStatus, handleOrderAction,  uploadReport,
} = require('../../../controllers/provider/Lab/LabsOrder'); // Apna LabOrderController import karein

// Base URL: /provider/labs

// Lab Operations
router.get('/dashboard', protect('provider'), getLabStats);
router.patch('/order-action/:orderId', protect('provider'), handleOrderAction);

router.patch('/update-progress/:orderId', protect('provider'), updateProgressStatus);
router.post('/upload-report/:orderId', protect('provider'), uploadReport);

module.exports = router;