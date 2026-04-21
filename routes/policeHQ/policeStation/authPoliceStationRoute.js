const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { registerPoliceStation, loginPoliceStation, updatePoliceStationProfile } = require('../../../controllers/policeHQ/policeStation/authPoliceStation');

// Auth Routes
router.post('/login', loginPoliceStation);

// Profile Management
router.put('/profile/update', protect('Police-Station'), updatePoliceStationProfile);

module.exports = router;