const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const { 
    getHospitalAllBookings,
    approveHospitalBooking,
    rejectHospitalBooking,
    getHospitalAppointmentStats  
} = require('../../../controllers/hospital/hospitalDoctor/hosAppoinment');

// base route: /hospital/doctor/appointments

// 1. Dashboard Stats (Total Bookings, Revenue etc.)
router.get('/stats', protect('hospital'), getHospitalAppointmentStats);

// 2. Hospital Admin Dashboard: View all bookings for their staff doctors
router.get('/all-bookings', protect('hospital'), getHospitalAllBookings);

// 3. Action: Approve appointment (Moves from Hospital-Pending to Confirmed)
router.patch('/approve/:id', protect('hospital'), approveHospitalBooking);

// 4. Action: Reject appointment
router.patch('/reject/:id', protect('hospital'), rejectHospitalBooking);

module.exports = router;