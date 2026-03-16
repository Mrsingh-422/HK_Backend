const express = require('express');
const router = express.Router();
const { protect } = require('../../../../middleware/authMiddleware');
const { contentUploads } = require('../../../../middleware/multer'); // Same Multer

const {
    updateNurseHero, getNurseHero,
    updateNursePrescription, getNursePrescription,
    updateNursingSteps, getNursingSteps,
    updateNursingServices, getNursingServices,
    updateExperiencedNurses, getExperiencedNurses,
    updateOnlyTheBestCare, getOnlyTheBestCare
} = require('../../../../controllers/admin/user/Home/NursePage'); // Apna controller import karein (eg. NursePageController)

// Base URL assumed: /api/nursepage

// ===========================
// 1. NURSE MAIN HERO
// ===========================
router.get('/hero', getNurseHero);
router.post('/hero', protect('admin'), contentUploads, updateNurseHero);

// ===========================
// 2. NURSE PRESCRIPTION
// ===========================
router.get('/prescription', getNursePrescription);
router.post('/prescription', protect('admin'), contentUploads, updateNursePrescription);

// ===========================
// 3. NURSING STEPS
// ===========================
router.get('/steps', getNursingSteps);
router.post('/steps', protect('admin'), contentUploads, updateNursingSteps);

// ===========================
// 4. OUR NURSING SERVICES
// ===========================
router.get('/services', getNursingServices);
router.post('/services', protect('admin'), contentUploads, updateNursingServices);

// ===========================
// 5. EXPERIENCED NURSES
// ===========================
router.get('/experienced-nurses', getExperiencedNurses);
router.post('/experienced-nurses', protect('admin'), contentUploads, updateExperiencedNurses);

// ===========================
// 6. ONLY THE BEST CARE
// ===========================
router.get('/best-care', getOnlyTheBestCare);
router.post('/best-care', protect('admin'), contentUploads, updateOnlyTheBestCare);

module.exports = router;