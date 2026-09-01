const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { hospitalUploads } = require('../../middleware/multer.js');
const { 
    registerHospital, checkHospitalExists,
    loginHospital, toggleHospitalOnlineStatus,
    updateHospitalProfile,getMyHospitalProfile,
    getLatestHospitalProfileRequest,changeHospitalPassword
} = require('../../controllers/hospital/authHospital.js');

// Base route: /api/auth/hospital

// --- 1. Authentication ---
router.post('/register', registerHospital);
router.post('/check-exists', checkHospitalExists);
router.post('/login', loginHospital);

router.patch('/status/toggle', protect('hospital'), toggleHospitalOnlineStatus);

// --- 3. Protected Routes ---
router.put('/profile/update',  
    protect('hospital'),
    hospitalUploads, 
    updateHospitalProfile,
);
router.get('/profile', protect('hospital'), getMyHospitalProfile);

router.get('/profile/update-status', protect('hospital'), getLatestHospitalProfileRequest);

router.patch('/change-password', protect('hospital'), changeHospitalPassword);

module.exports = router;