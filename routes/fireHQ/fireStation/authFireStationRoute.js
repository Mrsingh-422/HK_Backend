const express = require('express');
const router = express.Router();
const { fireStationUpdateUploads } = require('../../../middleware/multer');
const { loginStation, updateStationProfile, getStationProfile,changePassword,
    sendStationOTP, verifyStationOTP
 } = require('../../../controllers/fireHQ/fireStation/authfireStation');
const { protect } = require('../../../middleware/authMiddleware'); 

// Base URL: /fireStation/auth

// Public Routes
router.post('/login', loginStation);

// Protected Routes
router.put('/profile/update',fireStationUpdateUploads, protect('fire-station'), updateStationProfile);
router.get('/profile', protect('fire-station'), getStationProfile);
router.put('/password/update', protect('fire-station'), changePassword);

// OTP Routes for Password Reset
router.post('/otp/send', sendStationOTP);
router.post('/otp/verify', verifyStationOTP);

module.exports = router;