const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { doctorDocUploads } = require('../../middleware/multer');
const { 
    registerDoctor, 
    verifyOTP, 
    uploadDocuments, 
    loginDoctor ,toggleDoctorOnlineStatus,
    updateDoctorProfile,getDoctorProfile, getDoctorById
} = require('../../controllers/doctor/authDoctor');

// Base route: /api/auth/doctor

// 1. Register (Step 1)
router.post('/register', registerDoctor);

// 2. OTP Verify (Step 2)
router.post('/verify-otp', verifyOTP);

// 3. Document Upload (Step 3) - Protected
router.put('/upload-docs', protect('doctor'), doctorDocUploads, uploadDocuments);

// 4. Login
router.post('/login', loginDoctor);

// 4. Toggle Online Status
router.patch('/status/toggle', protect('doctor'), toggleDoctorOnlineStatus);

// 5. Update Profile (Optional)
router.put(
    '/update-profile', 
    protect('doctor'), 
    doctorDocUploads,
    updateDoctorProfile
);

// 6. Get Doctor Profile (Self)
router.get('/profile', protect('doctor'), getDoctorProfile);

// 7. Get Doctor by ID (Public/Admin/Patient view)
router.get('/profile/:id', protect('doctor'), getDoctorById);

module.exports = router;