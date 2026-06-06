const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    updateDocRescheduleLimit,
    getDocRescheduleLimit,
    getDoctors,
    approveDoctorStatus,
    toggleDoctorActiveStatus,adminGetApprovedDoctors, adminGetDoctorAppointments
} = require('../../../controllers/admin/Doctor/DoctorAdmin');

// Base URL: /admin/doctor

// Global Reschedule limits routes
router.patch('/update-reschedule-limit', protect('admin'), updateDocRescheduleLimit);
router.get('/reschedule-limit', protect('admin'), getDocRescheduleLimit);

// --- NEWLY ADDED DOCTOR MANAGEMENT ROUTES ---
router.get('/list', protect('admin'), getDoctors); // Doctor list filters ke sath
router.patch('/approve/:id', protect('admin'), approveDoctorStatus); // Approve/Reject status
router.patch('/toggle-active/:id', protect('admin'), toggleDoctorActiveStatus); // Active/Inactive toggle

// --- NEWLY ADDED DOCTOR APPROVED DOCTORS ROUTES ---
router.get('/approved-list', protect('admin'), adminGetApprovedDoctors);
// --- NEWLY ADDED DOCTOR APPOINTMENT ROUTES ---
router.get('/appointments', protect('admin'), adminGetDoctorAppointments);

module.exports = router;