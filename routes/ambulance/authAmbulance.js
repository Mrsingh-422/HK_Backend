const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { ambulanceDocUploads } = require('../../middleware/multer');
const { registerAmbulance, loginAmbulance, completeAmbulanceProfile, toggleDriverAvailability,getMyAmbulanceProfile } = require('../../controllers/ambulance/authAmbulance');

// Base URL: /api/auth/ambulance

router.post('/register', registerAmbulance);
router.post('/login', loginAmbulance);
// Step 2 onwards requires token
router.put('/complete-profile', protect(['ambulance', 'hospital-ambulance']), ambulanceDocUploads, completeAmbulanceProfile);
router.patch('/status/toggle',protect(['ambulance', 'hospital-ambulance']), toggleDriverAvailability); // 👈 ADD THIS ROUTE
router.get('/profile', protect(['ambulance', 'hospital-ambulance']), getMyAmbulanceProfile);


module.exports = router;