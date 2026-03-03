const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware.js'); 
const { 
    registerUser, 
    loginUser, 
    updateUserProfile,
    forgotPassword,
    verifyOtp,
    resetPassword
} = require('../../controllers/user/authUser.js'); 

// Base route: /api/auth/user

// Auth
router.post('/register', registerUser);
router.post('/login', loginUser);

// Forgot Password Flow
router.post('/forgot-password', forgotPassword); // Sends OTP
router.post('/verify-otp', verifyOtp);           // Verifies OTP
router.post('/reset-password', resetPassword);   // Sets New Password

// Protected
router.put('/update', protect('user'), updateUserProfile);

module.exports = router;