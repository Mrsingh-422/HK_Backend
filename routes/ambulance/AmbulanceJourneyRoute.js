const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { 
    startAmbulanceRide, 
    completeAmbulanceRide, 
    updateAmbulanceGPS, 
    updateJourneyStatus 
} = require('../../controllers/ambulance/AmbulanceJourney');

// Base URL: /driver/ambulance

router.post('/start-ride', protect(['ambulance', 'hospital-ambulance']), startAmbulanceRide);
router.post('/complete-ride', protect(['ambulance', 'hospital-ambulance']), completeAmbulanceRide);

// Yeh route ab global aur trip-specific dono GPS update handle karega
router.patch('/update-location', protect(['ambulance', 'hospital-ambulance']), updateAmbulanceGPS);

router.patch('/update-journey-status', protect(['ambulance', 'hospital-ambulance']), updateJourneyStatus);

module.exports = router;