const express = require('express');
const router = express.Router();
const { protect } = require('../../../../middleware/authMiddleware');
const { contentUploads } = require('../../../../middleware/multer'); // Use same Multer

const {
    updateHospitalHero, getHospitalHero,
    updateHospitalFacility, getHospitalFacility,
    updateMainHowItWorks, getMainHowItWorks
} = require('../../../../controllers/admin/user/Home/HospitalPage');

// Base URL assumed: /api/hospitalpage

// ===========================
// 1. HOSPITAL MAIN HERO
// ===========================
router.get('/hero', getHospitalHero);
router.post('/hero', protect('admin'), contentUploads, updateHospitalHero);

// ===========================
// 2. HOSPITAL FACILITY
// ===========================
router.get('/facility', getHospitalFacility);
router.post('/facility', protect('admin'), contentUploads, updateHospitalFacility);

// ===========================
// 3. MAIN HOW IT WORKS
// ===========================
router.get('/how-it-works', getMainHowItWorks);
router.post('/how-it-works', protect('admin'), contentUploads, updateMainHowItWorks);

module.exports = router;