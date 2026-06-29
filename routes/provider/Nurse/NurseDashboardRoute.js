// routes/provider/Nurse/NurseDashboardRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { nurseServiceUploads, nurseDocUploads,userProfileUpload } = require('../../../middleware/multer');
const {
    getProviderDashboard, updateProviderProfile, manageNurseService,
    getMyServices, deleteService, getBookingRequests,
    handleBookingAction, getAvailableStaff, assignStaffToBooking, reassignStaffToBooking, getStaffByStatus, searchMasterConsumables,
    getOrderHistory, trackNurse
} = require('../../../controllers/provider/Nurse/NurseDashboard');

// base URL: /provider/nurse/dash

// DASHBOARD & PROFILE
router.get('/dashboard-stats', protect('nurse'), getProviderDashboard);
router.put('/profile/update', protect('nurse'), nurseDocUploads, updateProviderProfile);

// SERVICE MANAGEMENT
router.post('/service/manage', protect('nurse'), nurseDocUploads, manageNurseService);
router.put('/service/manage/:id', protect('nurse'), nurseDocUploads, manageNurseService);
router.get('/service/list', protect('nurse'), getMyServices); // Filter: ?status=Approved
router.delete('/service/delete/:id', protect('nurse'), deleteService);

// STAFF & BOOKING MANAGEMENT
router.get('/bookings', protect('nurse'), getBookingRequests); // Filter: ?status=Pending
router.post('/booking/action', protect('nurse'), handleBookingAction);
router.get('/staff/available', protect('nurse'), getAvailableStaff);
router.post('/staff/reassign', protect('nurse'), reassignStaffToBooking);
router.post('/staff/assign', protect('nurse'), assignStaffToBooking);
router.get('/staff/status', protect('nurse'), getStaffByStatus); // Filter: ?status=Available/Busy/Off-Duty
// CONSUMABLES (Master Search)
router.get('/consumables/search', protect('nurse'), searchMasterConsumables);

// ORDER HISTORY & Tracking
router.get('/orders/history', protect('nurse'), getOrderHistory);
router.get('/track/:bookingId', protect('nurse'), trackNurse);

module.exports = router;