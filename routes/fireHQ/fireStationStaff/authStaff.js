const express = require('express');
const router = express.Router();
const { loginStaff, updateStaffProfile } = require('../../controllers/fireHQ/fireStationStaff/authStaff');
const { protect } = require('../../middleware/authMiddleware');
const { upload } = require('../../middleware/multer'); 

// Auth Routes
router.post('/login', loginStaff);

// Profile Management
router.put('/profile/update', protect('Fire-Staff'), upload.single('profileImage'), updateStaffProfile);

module.exports = router;