const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../../middleware/authMiddleware');
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
router.post('/hero', protect('admin'), checkRoleAccess(1),contentUploads, updateAmbulanceHero);

router.get('/referral-hero', getReferralAmbulanceHero);
router.post('/referral-hero', protect('admin'), checkRoleAccess(2), contentUploads, updateReferralAmbulanceHero); 

router.get('/emergency-facility', getEmergencyFacility);
router.post('/emergency-facility', protect('admin'), checkRoleAccess(1), contentUploads, updateEmergencyFacility);

router.get('/accidental-emergency', getAccidentalEmergency);
router.post('/accidental-emergency', protect('admin'), checkRoleAccess(1), contentUploads, updateAccidentalEmergency);

router.get('/medical-emergency', getMedicalEmergency);
router.post('/medical-emergency', protect('admin'), checkRoleAccess(1), contentUploads, updateMedicalEmergency);

router.get('/referral-services', getReferralAmbulance);
router.post('/referral-services', protect('admin'), checkRoleAccess(1), contentUploads, updateReferralAmbulance);

module.exports = router;