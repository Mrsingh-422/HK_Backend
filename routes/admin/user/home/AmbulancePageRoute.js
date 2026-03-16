const express = require('express');
const router = express.Router();
const { protect } = require('../../../../middleware/authMiddleware');
const { contentUploads } = require('../../../../middleware/multer'); // Same Multer

const {
    updateAmbulanceHero, getAmbulanceHero,
    updateReferralAmbulanceHero, getReferralAmbulanceHero,
    updateEmergencyFacility, getEmergencyFacility,
    updateAccidentalEmergency, getAccidentalEmergency,
    updateMedicalEmergency, getMedicalEmergency,
    updateReferralAmbulance, getReferralAmbulance
} = require('../../../../controllers/admin/user/Home/AmbulancePage');

// Base URL assumed: /api/ambulancepage

// ===========================
// 1. AMBULANCE MAIN HERO
// ===========================
router.get('/hero', getAmbulanceHero);
router.post('/hero', protect('admin'), contentUploads, updateAmbulanceHero);

// ===========================
// 2. REFERRAL AMBULANCE HERO
// ===========================
router.get('/referral-hero', getReferralAmbulanceHero);
router.post('/referral-hero', protect('admin'), contentUploads, updateReferralAmbulanceHero);

// ===========================
// 3. EMERGENCY FACILITY
// ===========================
router.get('/emergency-facility', getEmergencyFacility);
router.post('/emergency-facility', protect('admin'), contentUploads, updateEmergencyFacility);

// ===========================
// 4. ACCIDENTAL EMERGENCY
// ===========================
router.get('/accidental-emergency', getAccidentalEmergency);
router.post('/accidental-emergency', protect('admin'), contentUploads, updateAccidentalEmergency);

// ===========================
// 5. MEDICAL EMERGENCY
// ===========================
router.get('/medical-emergency', getMedicalEmergency);
router.post('/medical-emergency', protect('admin'), contentUploads, updateMedicalEmergency);

// ===========================
// 6. REFERRAL AMBULANCE SERVICES
// ===========================
router.get('/referral-services', getReferralAmbulance);
router.post('/referral-services', protect('admin'), contentUploads, updateReferralAmbulance);

module.exports = router;