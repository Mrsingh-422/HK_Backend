const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { doctorDocUploads } = require('../../middleware/multer');
const { 
    registerDoctor, checkDoctorExists,
    uploadDocuments, 
    loginDoctor,
    toggleDoctorOnlineStatus,
    updateDoctorProfile,
    getDoctorProfile, 
    getDoctorById,
    getLatestDoctorProfileRequest, 
    changeDoctorPassword
} = require('../../controllers/doctor/authDoctor');

// Base route: /api/auth/doctor

// 1. Step 1: Register (Basic Info + Firebase Phone Verification)
router.post('/register', registerDoctor);
router.post('/check-exists', checkDoctorExists);

// 2. Step 2: Document Upload (Protected via Token received in Step 1)
router.put('/upload-docs', protect('doctor'), doctorDocUploads, uploadDocuments);

// 3. Login
router.post('/login', loginDoctor);

// 4. Toggle Online Status
router.patch('/status/toggle', protect('doctor'), toggleDoctorOnlineStatus);

// 5. Update Profile
router.put('/update-profile', protect('doctor'), doctorDocUploads, updateDoctorProfile);

// 6. Get Profiles
router.get('/profile', protect('doctor'), getDoctorProfile);
router.get('/profile/update-status', protect('doctor'), getLatestDoctorProfileRequest);
router.get('/profile/:id', protect('doctor'), getDoctorById);

// 7. Password Management
router.patch('/change-password', protect('doctor'), changeDoctorPassword);

module.exports = router;