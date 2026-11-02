const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const {loginPoliceStation, updatePoliceStationProfile } = require('../../../controllers/policeHQ/policeStation/authPoliceStation');

// Base URL: /policeStation/auth

// Auth Routes
router.post('/login', loginPoliceStation);

// Profile Management
router.put('/profile/update', protect('police-station'), updatePoliceStationProfile);

module.exports = router;