const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { saveDoctorVisitCharges, getDoctorVisitCharges } = require('../../controllers/doctor/DoctorVisitCharge');

// Base URL: /doctor/visit-charges

router.post('/save', protect('doctor'), saveDoctorVisitCharges);
router.get('/my-charges', protect('doctor'), getDoctorVisitCharges);

module.exports = router;