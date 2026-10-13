const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const { 
    getHospitalAllBookings,
    approveHospitalBooking,
    rejectHospitalBooking,
    getHospitalStats  ,
    collectHospitalOpdCounterPayment
} = require('../../../controllers/hospital/hospitalDoctor/hosAppoinment');

// Base URL: /hospital/doctor/appointments

router.get('/stats', protect('hospital'), getHospitalStats); // Dashboard Numbers
router.get('/all-bookings', protect('hospital'), getHospitalAllBookings); // Listing with filters
router.patch('/approve/:id', protect('hospital'), approveHospitalBooking);
router.patch('/reject/:id', protect('hospital'), rejectHospitalBooking);

router.patch('/collect-payment/:id', protect('hospital'), collectHospitalOpdCounterPayment);

module.exports = router;