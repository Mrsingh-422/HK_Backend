const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { startAmbulanceRide, completeAmbulanceRide, updateLiveLocation, updateJourneyStatus } = require('../../controllers/ambulance/AmbulanceJourney');

// Base URL: /driver/ambulance

router.post('/start-ride', protect('ambulance'), startAmbulanceRide);
router.post('/complete-ride', protect('ambulance'), completeAmbulanceRide);

router.patch('/update-location', protect('ambulance'), updateLiveLocation);
router.patch('/update-journey-status', protect('ambulance'), updateJourneyStatus);

module.exports = router;