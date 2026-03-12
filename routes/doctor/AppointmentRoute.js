const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');

const { 
    getDoctorBookings,
    getTodayBookings,
    confirmAppointment,
    doctorCancelAppointment,
    startVisit,
    completeWithPrescription
} = require('../../controllers/doctor/Appointment');

// Sabhi routes par protect('doctor') hai

// Listings
router.get('/patient-bookings', protect('doctor'), getDoctorBookings);
router.get('/today-appointments', protect('doctor'), getTodayBookings);

// Actions
router.patch('/confirm/:id', protect('doctor'), confirmAppointment);
router.patch('/cancel/:id', protect('doctor'), doctorCancelAppointment);
router.patch('/start-visit/:id', protect('doctor'), startVisit);
router.post('/complete/:id', protect('doctor'), completeWithPrescription);

module.exports = router;