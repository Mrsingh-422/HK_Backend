const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../middleware/authMiddleware');

const {
    getDoctorsList, approveDoctor, rejectDoctor,
    getHospitalsList, approveHospital, rejectHospital,
    getProvidersList, approveProvider, rejectProvider,
    getAmbulancesList, approveAmbulance, rejectAmbulance
} = require('../../controllers/admin/approvalController');

// --- DOCTOR MANAGEMENT (ID: 31) ---
router.get('/doctors', protect('admin'), checkRoleAccess(31), getDoctorsList);
router.patch('/doctors/approve/:id', protect('admin'), checkRoleAccess(31), approveDoctor);
router.patch('/doctors/reject/:id', protect('admin'), checkRoleAccess(31), rejectDoctor);

// --- HOSPITAL MANAGEMENT (ID: 4) ---
router.get('/hospitals', protect('admin'), checkRoleAccess(4), getHospitalsList);
router.patch('/hospitals/approve/:id', protect('admin'), checkRoleAccess(4), approveHospital);
router.patch('/hospitals/reject/:id', protect('admin'), checkRoleAccess(4), rejectHospital);

// --- AMBULANCE MANAGEMENT (ID: 39) ---
router.get('/ambulances', protect('admin'), checkRoleAccess(39), getAmbulancesList);
router.patch('/ambulances/approve/:id', protect('admin'), checkRoleAccess(39), approveAmbulance);
router.patch('/ambulances/reject/:id', protect('admin'), checkRoleAccess(39), rejectAmbulance);

// --- PROVIDER MANAGEMENT ---

// Pharmacy (ID: 28)
router.get('/providers/pharmacy', protect('admin'), checkRoleAccess(28), (req, res) => {
    req.query.category = 'Pharmacy';
    getProvidersList(req, res);
});
router.patch('/providers/pharmacy/approve/:id', protect('admin'), checkRoleAccess(28), approveProvider);
router.patch('/providers/pharmacy/reject/:id', protect('admin'), checkRoleAccess(28), rejectProvider);

// Lab (ID: 29)
router.get('/providers/lab', protect('admin'), checkRoleAccess(29), (req, res) => {
    req.query.category = 'Lab';
    getProvidersList(req, res);
});
router.patch('/providers/lab/approve/:id', protect('admin'), checkRoleAccess(29), approveProvider);
router.patch('/providers/lab/reject/:id', protect('admin'), checkRoleAccess(29), rejectProvider);

// Nursing (ID: 30)
router.get('/providers/nursing', protect('admin'), checkRoleAccess(30), (req, res) => {
    req.query.category = 'Nursing';
    getProvidersList(req, res);
});
router.patch('/providers/nursing/approve/:id', protect('admin'), checkRoleAccess(30), approveProvider);
router.patch('/providers/nursing/reject/:id', protect('admin'), checkRoleAccess(30), rejectProvider);

module.exports = router;