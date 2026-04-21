const express = require('express');
const router = express.Router();
const { loginStation, updateStationProfile } = require('../../controllers/fire/StationAuthController');
const { protect } = require('../../middleware/authMiddleware'); // Role check 'Fire-Station'
const { upload } = require('../../middleware/multer'); 

// Public Routes
router.post('/login', loginStation);

// Protected Routes
router.put('/profile/update', protect('Fire-Station'), upload.single('profileImage'), updateStationProfile);

module.exports = router;