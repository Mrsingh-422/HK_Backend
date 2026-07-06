const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { ambulanceDocUploads } = require('../../middleware/multer');
const { registerAmbulance, loginAmbulance, completeAmbulanceProfile, toggleDriverAvailability,getMyAmbulanceProfile,resetPasswordTest,
forgotPasswordAmbulance, verifyRecoveryOtp, resetPasswordWithOtp, updateAmbulanceProfile
 } = require('../../controllers/ambulance/authAmbulance');

// Base URL: /api/auth/ambulance

router.post('/register', registerAmbulance);
router.post('/login', loginAmbulance);
// Step 2 onwards requires token
router.put('/complete-profile', protect(['ambulance', 'hospital-ambulance']), ambulanceDocUploads, completeAmbulanceProfile);
router.patch('/status/toggle',protect(['ambulance', 'hospital-ambulance']), toggleDriverAvailability); // 👈 ADD THIS ROUTE
router.get('/profile', protect(['ambulance', 'hospital-ambulance']), getMyAmbulanceProfile);
router.patch('/profile/update', protect(['ambulance', 'hospital-ambulance']), updateAmbulanceProfile); // Figma: Edit profile


// --- FORGOT PASSWORD RECOVERY FLOW (Figma Popups) ---
router.post('/forgot-password', forgotPasswordAmbulance); // Screen A
router.post('/verify-recovery-otp', verifyRecoveryOtp);   // Screen B
router.patch('/reset-password-otp', resetPasswordWithOtp); // Screen C


//testing only
router.put('/reset-password',protect(['ambulance', 'hospital-ambulance']),resetPasswordTest);


module.exports = router;