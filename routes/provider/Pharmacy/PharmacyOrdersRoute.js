const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getPharmacyDashboardStats,
    getPharmacyOrders, 
    getAvailableDrivers, 
    assignDriverManual , reassignDriverManual,updateOrderStatus,

    submitPharmacistReview,getProviderPrescriptionRequests, getProviderPrescriptionRequestDetails, startPrescriptionReview,rejectPrescriptionRequest
} = require('../../../controllers/provider/Pharmacy/PharmacyOrders');

// Base: /provider/pharmacy/orders

router.get('/dashboard-stats', protect('pharmacy'), getPharmacyDashboardStats);
router.get('/list', protect('pharmacy'), getPharmacyOrders);
router.get('/available-drivers', protect('pharmacy'), getAvailableDrivers);
router.post('/assign-manual', protect('pharmacy'), assignDriverManual);
router.post('/reassign', protect('pharmacy'), reassignDriverManual);
router.patch('/status/:orderId', protect('pharmacy'), updateOrderStatus);

// ai prescription review
router.post(
    '/prescription-request/review/:requestId', protect('pharmacy')
    ,submitPharmacistReview
);
router.get(
    '/prescription-request/list', 
    protect('pharmacy'), 
    getProviderPrescriptionRequests
);

router.get(
    '/prescription-request/details/:requestId', 
    protect('pharmacy'), 
    getProviderPrescriptionRequestDetails
);

router.post(
    '/prescription-request/start-review/:requestId', 
    protect('pharmacy'), 
    startPrescriptionReview
);
router.post(
    '/prescription-request/reject/:requestId', 
    protect('pharmacy'), 
    rejectPrescriptionRequest
);

module.exports = router;