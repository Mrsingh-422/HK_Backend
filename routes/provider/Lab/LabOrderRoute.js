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
    getDraftResults, // 👈 Added
    getProviderLabPrescriptionRequests,
    getProviderLabPrescriptionRequestDetails,
    startLabPrescriptionReview,
    submitLabReviewBill,
    rejectLabPrescriptionRequest,
    getAvailablePhlebotomists,
    assignDriverStaff,
    reassignDriverStaff,
    getBookingTrackingDetails
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

// AI prescriptioin Flow
router.get(
    '/prescription-request/list', 
    protect('provider'), 
    getProviderLabPrescriptionRequests
);

router.get(
    '/prescription-request/details/:requestId', 
    protect('provider'), 
    getProviderLabPrescriptionRequestDetails
);

router.post(
    '/prescription-request/start-review/:requestId', 
    protect('provider'), 
    startLabPrescriptionReview
);

router.post(
    '/prescription-request/review/:requestId', 
    protect('provider'), 
    submitLabReviewBill
);

router.post(
    '/prescription-request/reject/:requestId', 
    protect('provider'), 
    rejectLabPrescriptionRequest
);
 
router.get('/available-phlebotomists', protect('provider'), getAvailablePhlebotomists);
 
// Assign staff / phlebotomist (First time)
router.patch('/assign-staff/:orderId', protect('provider'), assignDriverStaff);
 
// Re-assign staff / phlebotomist (Changes driver and resets timestamps)
router.patch('/reassign-staff/:orderId', protect('provider'), reassignDriverStaff);
 
// Get live tracking detail schema for modal popups
router.get('/booking-tracking/:orderId', protect('provider'), getBookingTrackingDetails);
 



module.exports = router;