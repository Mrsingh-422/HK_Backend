const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { 
    getMyConsultationFees, 
    updateConsultationFees,  
    updateConsultationSettings
} = require('../../controllers/doctor/DoctorSettings');

// Base URL: /doctor/settings

// 'doctor' aur 'hospital-doctor' dono isey use kar sakte hain
router.get('/fees', protect('doctor'), getMyConsultationFees);
router.put('/update-fees', protect('doctor'), updateConsultationFees);

router.put('/update-settings', protect('doctor'), updateConsultationSettings);

module.exports = router;