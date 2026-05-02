const express = require('express');
const router = express.Router();
const { fireStationUpdateUploads } = require('../../../middleware/multer');
const { loginStation, updateStationProfile, getStationProfile,changePassword } = require('../../../controllers/fireHQ/fireStation/authfireStation');
const { protect } = require('../../../middleware/authMiddleware'); 

// Base URL: /fireStation/auth

// Public Routes
router.post('/login', loginStation);

// Protected Routes
router.put('/profile/update',fireStationUpdateUploads, protect('fire-station'), updateStationProfile);
router.get('/profile', protect('fire-station'), getStationProfile);
router.put('/password/update', protect('fire-station'), changePassword);

module.exports = router;