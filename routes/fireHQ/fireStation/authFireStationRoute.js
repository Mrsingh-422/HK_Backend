const express = require('express');
const router = express.Router();
const { loginStation, updateStationProfile } = require('../../../controllers/fireHQ/fireStation/authfireStation');
const { protect } = require('../../../middleware/authMiddleware'); 

// Base URL: /fireStation/auth

// Public Routes
router.post('/login', loginStation);

// Protected Routes
router.put('/profile/update', protect('fire-station'), updateStationProfile);

module.exports = router;