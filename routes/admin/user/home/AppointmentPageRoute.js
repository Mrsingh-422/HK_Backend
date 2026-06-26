const express = require('express');
const router = express.Router();
const { protect ,checkRoleAccess} = require('../../../../middleware/authMiddleware');
const { contentUploads } = require('../../../../middleware/multer'); // Aapka existing multer

const {
    updateFindDoctor, getFindDoctor,
    updateFindConsultant, getFindConsultant,
    updateDoctorsPriority, getDoctorsPriority,
    updateHowToSecure, getHowToSecure
} = require('../../../../controllers/admin/user/Home/AppointmentPage');

// Base URL assumed: /api/appointmentpage

// ===========================
// 1. FIND DOCTOR
// ===========================
router.get('/find-doctor', getFindDoctor);
router.post('/find-doctor', protect('admin'), checkRoleAccess(1),contentUploads, updateFindDoctor);

// ===========================
// 2. FIND CONSULTANT
// ===========================
router.get('/find-consultant', getFindConsultant);
router.post('/find-consultant', protect('admin'), checkRoleAccess(1),contentUploads, updateFindConsultant);

// ===========================
// 3. DOCTORS PRIORITY
// ===========================
router.get('/doctors-priority', getDoctorsPriority);
router.post('/doctors-priority', protect('admin'), checkRoleAccess(1), contentUploads, updateDoctorsPriority);

// ===========================
// 4. HOW TO SECURE
// ===========================
router.get('/how-to-secure', getHowToSecure);
router.post('/how-to-secure', protect('admin'), checkRoleAccess(1), contentUploads, updateHowToSecure);

module.exports = router;