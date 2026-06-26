const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware'); // Admin Check
const {
    addSpecialization,
    getSpecializations,
    addQualification,
    getQualifications,

    updateSpecialization,
    deleteSpecialization,
    updateQualification,
    deleteQualification
} = require('../../../controllers/admin/others/doctorDataController');

//base URL: /admin/doctor-data

// --- ADMIN ROUTES (Protected) ---
router.post('/add-specialization', protect('admin'),checkRoleAccess(37), addSpecialization);
router.post('/add-qualification', protect('admin'), checkRoleAccess(38), addQualification);

// --- PUBLIC ROUTES (No Token Required - For Registration Form) ---
router.get('/specializations', getSpecializations);
router.get('/qualifications', getQualifications);

// --- UPDATE ---
router.put('/update-specialization/:id', protect('admin'), checkRoleAccess(37), updateSpecialization);
router.put('/update-qualification/:id', protect('admin'), checkRoleAccess(38), updateQualification);

// --- DELETE ---
router.delete('/delete-specialization/:id', protect('admin'), checkRoleAccess(37), deleteSpecialization);
router.delete('/delete-qualification/:id', protect('admin'), checkRoleAccess(38), deleteQualification);

module.exports = router;