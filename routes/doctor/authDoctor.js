const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { registerDoctor, loginDoctor, updateDoctorProfile } = require('../../controllers/doctor/authDoctor.js');

// Base route: /api/auth/doctor

router.post('/register', registerDoctor);
router.post('/login', loginDoctor);
router.put('/update', protect('doctor'), updateDoctorProfile);

module.exports = router;