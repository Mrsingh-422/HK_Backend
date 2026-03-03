const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware'); // Admin Check
const {
    addSpecialization,
    getSpecializations,
    addQualification,
    getQualifications
} = require('../../../controllers/admin/others/doctorDataController');

// --- ADMIN ROUTES (Protected) ---
router.post('/add-specialization', protect('admin'), addSpecialization);
router.post('/add-qualification', protect('admin'), addQualification);

// --- PUBLIC ROUTES (No Token Required - For Registration Form) ---
router.get('/specializations', getSpecializations);
router.get('/qualifications', getQualifications);

module.exports = router;