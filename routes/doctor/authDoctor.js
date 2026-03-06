const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { doctorDocUploads } = require('../../middleware/multer');
const { 
    registerDoctor, 
    verifyOTP, 
    uploadDocuments, 
    loginDoctor 
} = require('../../controllers/doctor/authDoctor');

// 1. Register (Step 1)
router.post('/register', registerDoctor);

// 2. OTP Verify (Step 2)
router.post('/verify-otp', verifyOTP);

// 3. Document Upload (Step 3) - Protected
router.put('/upload-docs', protect('doctor'), doctorDocUploads, uploadDocuments);

// 4. Login
router.post('/login', loginDoctor);

module.exports = router;