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
    uploadReport ,
    
    generateAndUploadSmartReport,getReportTemplates,getReportTemplatesDropdown, // 👈 Added
    getReportTemplatesForBooking, // 👈 Added
    saveDraftResults, // 👈 Added
    getDraftResults // 👈 Added
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

// 🚨 NEW REAL-TIME SMART REPORT HANDSHAKE ENDPOINTS
router.get('/report-templates', protect('provider'), getReportTemplates);
router.get('/report-templates/dropdown', protect('provider'), getReportTemplatesDropdown); // Dropdown List API
router.get('/report-templates/booking/:orderId', protect('provider'), getReportTemplatesForBooking); // Smart Auto-Resolver API

router.post('/save-draft/:orderId', protect('provider'), saveDraftResults); // Save Draft API
router.get('/get-draft/:orderId', protect('provider'), getDraftResults); // Get Draft API

router.post('/generate-report/:orderId', protect('provider'), generateAndUploadSmartReport);



module.exports = router;