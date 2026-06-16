const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getNurseBookings, 
    getBookingDetail,
    respondToBooking, 
    updateProgress, 
    verifyOtpAndStartService, 
    completeService,
    reportNurseIssue,
    toggleDriverStatus,reassignNurseDueToEmergency
} = require('../../../controllers/driver/driverNurse/NurseDriverOrders');

// Base URL: /driver/nurse/orders

router.get('/list', protect('driver'), getNurseBookings);
router.get('/detail/:bookingId', protect('driver'), getBookingDetail);
router.patch('/respond/:bookingId', protect('driver'), respondToBooking);
router.patch('/update-progress/:bookingId', protect('driver'), updateProgress);
router.post('/verify-start-otp', protect('driver'), verifyOtpAndStartService);
router.post('/complete', protect('driver'), completeService);
router.post('/report-issue/:bookingId', protect('driver'), reportNurseIssue);
router.patch('/toggle-status', protect('driver'), toggleDriverStatus);
router.post('/reassign-emergency', protect('driver'), reassignNurseDueToEmergency);

module.exports = router;