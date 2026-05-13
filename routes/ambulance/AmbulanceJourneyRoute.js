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

router.post('/start-ride', protect('ambulance'), startAmbulanceRide);
router.post('/complete-ride', protect('ambulance'), completeAmbulanceRide);

// Yeh route ab global aur trip-specific dono GPS update handle karega
router.patch('/update-location', protect('ambulance'), updateAmbulanceGPS);

router.patch('/update-journey-status', protect('ambulance'), updateJourneyStatus);

module.exports = router;