const express = require('express');
const router = express.Router();
const { loginStaff, updateStaffProfile } = require('../../../controllers/fireHQ/fireStationStaff/authStaff');
const { protect } = require('../../../middleware/authMiddleware');
const { upload } = require('../../../middleware/multer'); 

// Base URL: /fireStaff/auth

// Auth Routes
router.post('/login', loginStaff);

// Profile Management
router.put('/profile/update', protect('fire-staff'), updateStaffProfile);

module.exports = router;