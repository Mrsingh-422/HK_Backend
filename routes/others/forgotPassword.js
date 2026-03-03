const express = require('express');
const router = express.Router();
const { forgotPassword, verifyOtp, resetPassword } = require('../../controllers/others/forgotPassword.js');

//end point base: /api/password

// --- 1. Forgot Password Flow ---
router.post('/forgot-password', forgotPassword); // Sends OTP to email
router.post('/verify-otp', verifyOtp);           // Verifies OTP
router.post('/reset-password', resetPassword);   // Sets new password


module.exports = router;