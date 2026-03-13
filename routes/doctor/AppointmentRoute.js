const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');

const { 
    getDoctorBookings,
    getTodayBookings,
    confirmAppointment,
    doctorCancelAppointment,
    startVisit,
    completeWithPrescription, 
    updateLiveLocation, 
    startVideoCall,
    updateDoctorSettings,
    setAvailability,
    getDoctorStats
} = require('../../controllers/doctor/Appointment');

// Listings
router.get('/patient-bookings', protect('doctor'), getDoctorBookings);
router.get('/today-appointments', protect('doctor'), getTodayBookings);
router.get('/stats', protect('doctor'), getDoctorStats);

// Actions
router.patch('/confirm/:id', protect('doctor'), confirmAppointment);
router.patch('/cancel/:id', protect('doctor'), doctorCancelAppointment);
router.patch('/start-visit/:id', protect('doctor'), startVisit);
router.post('/complete/:id', protect('doctor'), completeWithPrescription);
router.patch('/update-location/:id', protect('doctor'), updateLiveLocation);
router.post('/start-video/:id', protect('doctor'), startVideoCall);

// Settings & Slots
router.patch('/update-settings', protect('doctor'), updateDoctorSettings);
router.post('/set-availability', protect('doctor'), setAvailability);

module.exports = router;