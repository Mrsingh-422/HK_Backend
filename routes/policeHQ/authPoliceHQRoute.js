const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { registerPoliceHQ, loginPoliceHQ, updatePoliceHQProfile, getLatestPoliceHQProfileRequest,
    forgotPasswordRequest, verifyOtpRequest, resetPasswordAfterVerification
 } = require('../../controllers/policeHQ/authPoliceHQ');

// Base URL: /policeHQ/auth

router.post('/register', protect('admin'), registerPoliceHQ);
router.post('/login', loginPoliceHQ);
router.put('/update', protect('Police-HQ'), updatePoliceHQProfile);
router.get('/profile/update-status', protect('Police-HQ'), getLatestPoliceHQProfileRequest);


router.post('/forgot-password', forgotPasswordRequest); // Screen 18 - Send OTP API
router.post('/verify-otp', verifyOtpRequest); // Screen 19 - Verify OTP API
router.post('/reset-password', resetPasswordAfterVerification); // Post-OTP Reset API

module.exports = router;