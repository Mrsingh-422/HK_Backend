const express = require('express');
const router = express.Router();
const { loginStaff, updateStaffProfile, forgotPassword, 
    verifyOTP, 
    resetPassword , changePassword } = require('../../../controllers/fireHQ/fireStationStaff/authStaff');
const { protect } = require('../../../middleware/authMiddleware');
const { upload } = require('../../../middleware/multer'); 

// Base URL: /fireStaff/auth

// Auth Routes
router.post('/login', loginStaff);

// Profile Management
router.put('/profile/update', protect('fire-staff'), updateStaffProfile);


// Password Reset Flow
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyOTP);
router.post('/reset-password', resetPassword);

router.post('/change-password', protect('fire-staff'), changePassword); // For authenticated users changing password in settings

module.exports = router;