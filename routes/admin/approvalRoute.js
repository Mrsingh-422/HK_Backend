const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../middleware/authMiddleware');

const {
    getDoctorsList, approveDoctor, rejectDoctor,
    getHospitalsList, approveHospital, rejectHospital,
    getLabsList, approveLab, rejectLab,
    getPharmaciesList, approvePharmacy, rejectPharmacy,
    getNursesList, approveNurse, rejectNurse,
    getAmbulancesList, approveAmbulance, rejectAmbulance
} = require('../../controllers/admin/approvalController');

// Base Path: /api/admin/approval

// --- DOCTOR (ID: 31) ---
router.get('/doctors', protect('admin'), checkRoleAccess(31), getDoctorsList);
router.patch('/doctors/approve/:id', protect('admin'), checkRoleAccess(31), approveDoctor);
router.patch('/doctors/reject/:id', protect('admin'), checkRoleAccess(31), rejectDoctor);

// --- HOSPITAL (ID: 4) ---
router.get('/hospitals', protect('admin'), checkRoleAccess(4), getHospitalsList);
router.patch('/hospitals/approve/:id', protect('admin'), checkRoleAccess(4), approveHospital);
router.patch('/hospitals/reject/:id', protect('admin'), checkRoleAccess(4), rejectHospital);

// --- PHARMACY (ID: 28) ---
router.get('/pharmacy', protect('admin'), checkRoleAccess(28), getPharmaciesList);
router.patch('/pharmacy/approve/:id', protect('admin'), checkRoleAccess(28), approvePharmacy);
router.patch('/pharmacy/reject/:id', protect('admin'), checkRoleAccess(28), rejectPharmacy);

// --- LAB (ID: 29) ---
router.get('/lab', protect('admin'), checkRoleAccess(29), getLabsList);
router.patch('/lab/approve/:id', protect('admin'), checkRoleAccess(29), approveLab);
router.patch('/lab/reject/:id', protect('admin'), checkRoleAccess(29), rejectLab);

// --- NURSING (ID: 30) ---
router.get('/nursing', protect('admin'), checkRoleAccess(30), getNursesList);
router.patch('/nursing/approve/:id', protect('admin'), checkRoleAccess(30), approveNurse);
router.patch('/nursing/reject/:id', protect('admin'), checkRoleAccess(30), rejectNurse);

// --- AMBULANCE (ID: 39) ---
router.get('/ambulances', protect('admin'), checkRoleAccess(39), getAmbulancesList);
router.patch('/ambulances/approve/:id', protect('admin'), checkRoleAccess(39), approveAmbulance);
router.patch('/ambulances/reject/:id', protect('admin'), checkRoleAccess(39), rejectAmbulance);

module.exports = router;