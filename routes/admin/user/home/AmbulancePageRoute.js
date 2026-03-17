const express = require('express');
const router = express.Router();
const { protect } = require('../../../../middleware/authMiddleware');
const { contentUploads } = require('../../../../middleware/multer');

const {
    updateAmbulanceHero, getAmbulanceHero,
    updateReferralAmbulanceHero, getReferralAmbulanceHero,
    updateEmergencyFacility, getEmergencyFacility,
    updateAccidentalEmergency, getAccidentalEmergency,
    updateMedicalEmergency, getMedicalEmergency,
    updateReferralAmbulance, getReferralAmbulance
} = require('../../../../controllers/admin/user/Home/AmbulancePage');

// Route updates: ContentUploads is used to handle files.
// Ensure your frontend sends old images as 'existingImages[]' and new as 'carouselImages'.

router.get('/hero', getAmbulanceHero);
router.post('/hero', protect('admin'), contentUploads, updateAmbulanceHero);

router.get('/referral-hero', getReferralAmbulanceHero);
router.post('/referral-hero', protect('admin'), contentUploads, updateReferralAmbulanceHero); 

router.get('/emergency-facility', getEmergencyFacility);
router.post('/emergency-facility', protect('admin'), contentUploads, updateEmergencyFacility);

router.get('/accidental-emergency', getAccidentalEmergency);
router.post('/accidental-emergency', protect('admin'), contentUploads, updateAccidentalEmergency);

router.get('/medical-emergency', getMedicalEmergency);
router.post('/medical-emergency', protect('admin'), contentUploads, updateMedicalEmergency);

router.get('/referral-services', getReferralAmbulance);
router.post('/referral-services', protect('admin'), contentUploads, updateReferralAmbulance);

module.exports = router;