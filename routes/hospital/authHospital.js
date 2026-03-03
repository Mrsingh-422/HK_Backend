const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { hospitalUploads } = require('../../middleware/multer.js');
const { 
    registerHospital, 
    loginHospital, 
    updateHospitalProfile
} = require('../../controllers/hospital/authHospital.js');

// Base route: /api/auth/hospital

// --- 1. Authentication ---
router.post('/register', registerHospital);
router.post('/login', loginHospital);

// --- 3. Protected Routes ---
router.put('/update',  
    protect('hospital'),
    hospitalUploads, 
    updateHospitalProfile
);

module.exports = router;