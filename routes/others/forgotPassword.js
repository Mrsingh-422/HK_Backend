const express = require('express');
const router = express.Router();
const { 
    forgotPassword, verifyOtp, resetPassword,
    forgotPasswordPhone, verifyFirebaseOtp, resetPasswordPhone 
} = require('../../controllers/others/forgotPassword.js');

// Endpoint Base: /api/password

// ==========================================
// ✉️ 1. Email OTP Flow (Brevos Email)
// ==========================================
router.post('/forgot-password', forgotPassword); 
router.post('/verify-otp', verifyOtp);           
router.post('/reset-password', resetPassword);   

// ==========================================
// 📱 2. Firebase Mobile SMS OTP Flow (Universal Vendors & Users)
// ==========================================
router.post('/forgot-password-phone', forgotPasswordPhone); 
router.post('/verify-firebase-otp', verifyFirebaseOtp);     
router.post('/reset-password-phone', resetPasswordPhone);   

module.exports = router;