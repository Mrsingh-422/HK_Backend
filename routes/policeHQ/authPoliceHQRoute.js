const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { policeHQUploads } = require('../../middleware/multer');
const { registerPoliceHQ, loginPoliceHQ, updatePoliceHQProfile, getLatestPoliceHQProfileRequest,
    forgotPasswordRequest, verifyOtpRequest, resetPasswordAfterVerification,
    getHQProfile, changePasswordHQ

 } = require('../../controllers/policeHQ/authPoliceHQ');

// Base URL: /policeHQ/auth

router.post('/register', protect('admin'), registerPoliceHQ);
router.post('/login', loginPoliceHQ);

router.get('/profile', protect('police-hq'), getHQProfile); // 👈 Registered Profile Endpoint
router.put('/update', protect('police-hq'), policeHQUploads, updatePoliceHQProfile);
router.get('/profile/update-status', protect('police-hq'), getLatestPoliceHQProfileRequest);

router.put('/change-password', protect('police-hq'), changePasswordHQ); // 👈 Registered Password Endpoint


router.post('/forgot-password', forgotPasswordRequest); // Screen 18 - Send OTP API
router.post('/verify-otp', verifyOtpRequest); // Screen 19 - Verify OTP API
router.post('/reset-password', resetPasswordAfterVerification); // Post-OTP Reset API

module.exports = router;