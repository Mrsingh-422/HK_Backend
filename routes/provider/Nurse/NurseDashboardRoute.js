// routes/provider/Nurse/NurseDashboardRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { nurseServiceUploads, nurseDocUploads,userProfileUpload } = require('../../../middleware/multer');
const {
    getProviderDashboard, updateProviderProfile, manageNurseService,
    getMyServices, deleteService, getBookingRequests,
    handleBookingAction, getAvailableStaff, assignStaffToBooking, searchMasterConsumables
} = require('../../../controllers/provider/Nurse/NurseDashboard');

// base URL: /provider/nurse/dash

// DASHBOARD & PROFILE
router.get('/dashboard-stats', protect('nurse'), getProviderDashboard);
router.put('/profile/update', protect('nurse'), userProfileUpload, updateProviderProfile);

// SERVICE MANAGEMENT
router.post('/service/manage', protect('nurse'), nurseDocUploads, manageNurseService);
router.put('/service/manage/:id', protect('nurse'), nurseDocUploads, manageNurseService);
router.get('/service/list', protect('nurse'), getMyServices); // Filter: ?status=Approved
router.delete('/service/delete/:id', protect('nurse'), deleteService);

// STAFF & BOOKING MANAGEMENT
router.get('/bookings', protect('nurse'), getBookingRequests); // Filter: ?status=Pending
router.post('/booking/action', protect('nurse'), handleBookingAction);
router.get('/staff/available', protect('nurse'), getAvailableStaff);
router.post('/staff/assign', protect('nurse'), assignStaffToBooking);

// CONSUMABLES (Master Search)
router.get('/consumables/search', protect('nurse'), searchMasterConsumables);

module.exports = router;