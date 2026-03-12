const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const { 
    getSpecializations, 
    searchDoctors, 
    getDoctorDetails, 
    bookAppointment, 
    getUserAppointments, 
    userCancelAppointment,
    trackAppointment , getMyPrescriptions
} = require('../../../controllers/user/Doctor/BookAppointment');

// PUBLIC
router.get('/specializations', getSpecializations);
router.get('/list', searchDoctors);
router.get('/details/:id', getDoctorDetails);

// PROTECTED (Requires User token)
router.post('/book', protect('user'), bookAppointment);
router.get('/my-appointments', protect('user'), getUserAppointments);
router.get('/track/:appointmentId', protect('user'), trackAppointment);
router.patch('/cancel/:id', protect('user'), userCancelAppointment);
router.get('/prescriptions', protect('user'), getMyPrescriptions);

module.exports = router;