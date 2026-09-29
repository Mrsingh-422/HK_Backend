const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { ambulanceDocUploads } = require('../../middleware/multer');
const { registerAmbulance, loginAmbulance,
checkAmbulanceExists, updateAmbulanceFcmToken, completeAmbulanceProfile, toggleDriverAvailability,getMyAmbulanceProfile,resetPasswordTest,
forgotPasswordAmbulance, verifyRecoveryOtp, resetPasswordWithOtp, updateAmbulanceProfile,getLatestAmbulanceProfileRequest,
changeDriverPassword,
setAmbulanceAvailability, getMyAmbulanceAvailability
 } = require('../../controllers/ambulance/authAmbulance');

// Base URL: /api/auth/ambulance

router.post('/register', registerAmbulance);

// Pre-check & FCM Rotation routes
router.post('/check-exists', checkAmbulanceExists);
router.post('/login', loginAmbulance);
// Step 2 onwards requires token
router.put('/complete-profile', protect(['ambulance', 'hospital-ambulance']), ambulanceDocUploads, completeAmbulanceProfile);
router.patch('/status/toggle',protect(['ambulance', 'hospital-ambulance']), toggleDriverAvailability); // 👈 ADD THIS ROUTE
router.get('/profile', protect(['ambulance', 'hospital-ambulance']), getMyAmbulanceProfile);
router.patch('/profile/update', protect(['ambulance', 'hospital-ambulance']), ambulanceDocUploads, updateAmbulanceProfile);
router.get('/profile/update-status', protect(['ambulance', 'hospital-ambulance']), getLatestAmbulanceProfileRequest);

// --- FORGOT PASSWORD RECOVERY FLOW (Figma Popups) ---
router.post('/forgot-password', forgotPasswordAmbulance); // Screen A
router.post('/verify-recovery-otp', verifyRecoveryOtp);   // Screen B
router.patch('/reset-password-otp', resetPasswordWithOtp); // Screen C

router.patch('/fcm-token', protect(['ambulance', 'hospital-ambulance']), updateAmbulanceFcmToken);
//testing only
router.put('/reset-password',protect(['ambulance', 'hospital-ambulance']),resetPasswordTest);

// --- CHANGE PASSWORD ---
router.patch('/change-password', protect(['ambulance', 'hospital-ambulance']), changeDriverPassword);

router.post('/availability/set', protect('ambulance'), setAmbulanceAvailability);
router.get('/availability/my-config', protect('ambulance'), getMyAmbulanceAvailability);


module.exports = router;