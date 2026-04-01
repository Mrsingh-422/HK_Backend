const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware.js'); 
const { 
    registerUser, 
    loginUser, 
    updateUserProfile,
    forgotPassword,
    verifyOtp,
    resetPassword,
    getUserProfile,
    editUserSubItem,
    removeUserSubItem
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

router.get('/profile', protect('user'), getUserProfile);

// Example: /api/auth/user/edit-sub-item/family/65a123...
router.put('/edit-sub-item/:type/:itemId', protect('user'), editUserSubItem);  // type: address/family/emergency
router.delete('/remove-sub-item/:type/:itemId', protect('user'), removeUserSubItem); // type: address/family/emergency

module.exports = router;