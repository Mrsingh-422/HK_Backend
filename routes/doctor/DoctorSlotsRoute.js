const express = require('express');
const router = express.Router();
// Ensure you have a 'protect' middleware that verifies 'doctor' role
const { protect } = require('../../middleware/authMiddleware'); 
const { 
    setDoctorSlots, 
    getDoctorSlots, 
    blockDoctorSlot, 
    unblockDoctorSlot 
} = require('../../controllers/doctor/DoctorSlots');

// Base URL: /doctor/availability

router.post('/set', protect('doctor'), setDoctorSlots);
router.get('/my-slots', protect('doctor'), getDoctorSlots);
router.post('/block', protect('doctor'), blockDoctorSlot);
router.post('/unblock', protect('doctor'), unblockDoctorSlot);

module.exports = router;