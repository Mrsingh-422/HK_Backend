const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { hospitalUploads } = require('../../middleware/multer.js');
const { 
    registerHospital, 
    loginHospital, 
    updateHospitalProfile,getMyHospitalProfile
} = require('../../controllers/hospital/authHospital.js');

// Base route: /api/auth/hospital

// --- 1. Authentication ---
router.post('/register', registerHospital);
router.post('/login', loginHospital);

// --- 3. Protected Routes ---
router.put('/update',  
    protect('hospital'),
    hospitalUploads, 
    updateHospitalProfile,
);
router.get('/profile', protect('hospital'), getMyHospitalProfile);

module.exports = router;