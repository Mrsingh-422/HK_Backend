const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { policeStaffUploads } = require('../../../middleware/multer');
const {
    getStaffDashboard,
    getAssignedCases,
    acceptCase,
    updateProgressStep,
    uploadEvidence,
    closeCase,
    getDetailedProfile,
    updateProfile,
    changePassword,
    submitLeave,

    checkInShift,
    submitRosterRequest,
    closeCaseWithReport,updateStaffCaseStatus ,addStaffCaseEvidence,
    getStaffNotifications,
    markAllStaffNotificationsRead,
    deleteStaffNotification
} = require('../../../controllers/policeHQ/policeStationStaff/staffController');

// Base URL: /policeStationStaff/staff
 
// All routes are protected for 'police-staff' role
router.use(protect('police-staff'));

// Figma Screen 37: Click Check-in button to trigger shift active duty
router.post('/shift/check-in', checkInShift);

/** LEAVE & ROSTER REQUEST **/
// Figma Screen 41/43: Submit Present or Leave request with attachment
router.post('/leave/request', policeStaffUploads, submitRosterRequest);

 
/** DASHBOARD & PROFILE **/
router.get('/dashboard', getStaffDashboard); // Screen 1
router.get('/profile-full', getDetailedProfile); // Screen 26
router.put('/profile-update', policeStaffUploads, updateProfile); // Screen 9
router.put('/change-password', changePassword); // Screen 8 (Modal)
 
/** CASE MANAGEMENT **/
router.get('/cases', getAssignedCases); // Screens 10 & 19
router.put('/cases/accept/:id', acceptCase); // Screen 10 Accept button
router.put('/cases/progress/:id', updateProgressStep); // Screen 19 Progress dots
router.post('/cases/evidence/:id', policeStaffUploads, uploadEvidence); // Screen 7 Upload
router.put('/cases/close/:id', closeCase); // Screen 19 Close button
 
/** LEAVE MANAGEMENT **/
router.post('/leave/request', submitLeave); // Screen 5 & 6


// Figma Screen 40: Close Case with remarks dropdown & final report upload
router.put('/cases/close/:id', policeStaffUploads, closeCaseWithReport);
// Card Action: Update Status (Site Visit Completed, Suspect Identified etc.)
router.put('/cases/:id/update-status', policeStaffUploads, updateStaffCaseStatus);

// Card Action: Add Evidence media (Photo, Video, FIR Copy etc.)
router.post('/cases/:id/add-evidence', policeStaffUploads, addStaffCaseEvidence);


/** NOTIFICATION SYSTEM (Figma Image 2, 3) **/
router.get('/notifications', getStaffNotifications);
router.put('/notifications/mark-all-read', markAllStaffNotificationsRead);
router.delete('/notifications/:id', deleteStaffNotification);
 
module.exports = router;
 