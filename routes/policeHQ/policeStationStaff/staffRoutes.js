// Clean routes/policeHQ/policeStationStaff/staffRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { policeStaffUploads, policeEvidenceUploads } = require('../../../middleware/multer');
const {
    getStaffDashboard,
    getAssignedCases,
    acceptCase,
    updateProgressStep,
    uploadEvidence,
    getDetailedProfile,
    updateProfile,
    changePassword,
    checkInShift,
    submitRosterRequest,
    closeCaseWithReport,
    updateStaffCaseStatus,
    addStaffCaseEvidence,
    getStaffCaseHistory,
    getStaffNotifications,
    markAllStaffNotificationsRead,
    deleteStaffNotification
} = require('../../../controllers/policeHQ/policeStationStaff/staffController');

// Base URL: /policeStationStaff/staff
router.use(protect('police-staff'));

/** SHIFT & ROSTER REQUEST **/
router.post('/shift/check-in', checkInShift);
router.post('/leave/request', policeStaffUploads, submitRosterRequest); // 👈 Handles Leave, Present & Shift Change with attachment

/** DASHBOARD & PROFILE **/
router.get('/dashboard', getStaffDashboard);
router.get('/profile-full', getDetailedProfile);
router.put('/profile-update', policeStaffUploads, updateProfile);
router.put('/change-password', changePassword);

/** CASE MANAGEMENT **/
router.get('/cases', getAssignedCases);
router.get('/cases/history', getStaffCaseHistory);
router.put('/cases/accept/:id', acceptCase);
router.put('/cases/progress/:id', updateProgressStep);
router.post('/cases/evidence/:id', policeStaffUploads, uploadEvidence);
router.put('/cases/close/:id', policeStaffUploads, closeCaseWithReport); // 👈 Handles closure with final report file
router.put('/cases/:id/update-status', policeEvidenceUploads, updateStaffCaseStatus);
router.post('/cases/:id/add-evidence', policeEvidenceUploads, addStaffCaseEvidence);

/** NOTIFICATIONS **/
router.get('/notifications', getStaffNotifications);
router.put('/notifications/mark-all-read', markAllStaffNotificationsRead);
router.delete('/notifications/:id', deleteStaffNotification);

module.exports = router;