const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    updateDocRescheduleLimit,
    getDocRescheduleLimit,
    getDoctors,
    approveDoctorStatus,
    toggleDoctorActiveStatus,adminGetApprovedDoctors, adminGetDoctorAppointments
} = require('../../../controllers/admin/Doctor/DoctorAdmin');

// Base URL: /admin/doctor

// Global Reschedule limits routes
router.patch('/update-reschedule-limit', protect('admin'), checkRoleAccess(31),updateDocRescheduleLimit);
router.get('/reschedule-limit', protect('admin'), checkRoleAccess(31), getDocRescheduleLimit);

// --- NEWLY ADDED DOCTOR MANAGEMENT ROUTES ---
router.get('/list', protect('admin'), checkRoleAccess(31), getDoctors); // Doctor list filters ke sath
router.patch('/approve/:id', protect('admin'), checkRoleAccess(31), approveDoctorStatus); // Approve/Reject status
router.patch('/toggle-active/:id', protect('admin'), checkRoleAccess(31), toggleDoctorActiveStatus); // Active/Inactive toggle

// --- NEWLY ADDED DOCTOR APPROVED DOCTORS ROUTES ---
router.get('/approved-list', protect('admin'), checkRoleAccess(5), adminGetApprovedDoctors);
// --- NEWLY ADDED DOCTOR APPOINTMENT ROUTES ---
router.get('/appointments', protect('admin'), checkRoleAccess(31), adminGetDoctorAppointments);

module.exports = router;