const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { labDocUploads } = require('../../../middleware/multer'); 
const { 
    getLabStats, getOrders, handleOrderAction, assignStaff, updateProgressStatus, uploadReport 
} = require('../../../controllers/provider/Lab/LabsOrder');

// Base URL: /provider/labs

router.get('/dashboard', protect('provider'), getLabStats);
router.get('/orders', protect('provider'), getOrders); // Filter by status
router.patch('/order-action/:orderId', protect('provider'), handleOrderAction);
router.patch('/assign-staff/:orderId', protect('provider'), assignStaff);
router.patch('/update-progress/:orderId', protect('provider'), updateProgressStatus);
router.post('/upload-report/:orderId', protect('provider'), labDocUploads, uploadReport);

module.exports = router;