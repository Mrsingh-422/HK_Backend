const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { policeHQUploads, policeStationUploads,policeEvidenceUploads } = require('../../middleware/multer');
const {
    getHQDashboard,
    createStation,
    listMyStations,
    updateStation,
    deleteStation,
    getFilteredCases,
    getHQProfile,
    updateHQProfile,
    changePasswordHQ,
    getNotifications,
    deleteNotification,
 
    createCase,
    updateCase,
    deleteCase,
    assignCase,getHQCaseHistory,getPendingCases,getClosedCases,getArchivedCases,

     updateCaseStatus,
    addEvidenceHQ,
    closeCaseHQ,
    reassignCaseHQ,

    sendSupportRequest
} = require('../../controllers/policeHQ/hqManagement');

// Base URL: /policeHQ/management
 
// All routes are protected by Police HQ Auth
router.use(protect('police-hq'));
 
/** DASHBOARD **/
router.get('/dashboard', getHQDashboard); // Screen 3
 
/** STATION MANAGEMENT **/
router.get('/stations', listMyStations); // Screen 4
router.post('/stations', policeStationUploads, createStation); // Screen 9
router.put('/stations/:id', policeStationUploads, updateStation); // Screen 7
router.delete('/stations/:id', deleteStation); // Screen 8
 
/** CASE MANAGEMENT **/
// Usage: /cases?status=Fresh&subType=New or /cases?status=Under Investigation
router.get('/cases', getFilteredCases); // Screens 13, 14, 18, 19
// router.post('/cases/assign', assignCase); // Screen 20
 
/** PROFILE MANAGEMENT **/
router.get('/profile', getHQProfile); // Screen 10
router.put('/profile', policeHQUploads, updateHQProfile); // Screen 12
router.put('/change-password', changePasswordHQ); // Screen 15
 
/** NOTIFICATIONS **/
router.get('/notifications', getNotifications); // Screen 21
router.delete('/notifications/:id', deleteNotification); // Screen 22 (Swipe delete)
 
router.post('/cases', createCase);
 
// Update specific case details by ID
router.put('/cases/:id', updateCase);
 
// Delete a case from records
router.delete('/cases/:id', deleteCase);
 
// Assign a case to a specific Police Station and Staff
router.post('/cases/assign/:id', assignCase);

router.get('/case-history', getHQCaseHistory);
// SPECIFIC STATUS APIs (Adding our new APIs here)
router.get('/cases/pending', getPendingCases);    // Active/Pending Cases
router.get('/cases/closed', getClosedCases);      // Completed/Closed Cases
router.get('/cases/archived', getArchivedCases);  // Archived Cases
 
 router.patch('/cases/:id/status', updateCaseStatus); // Screen 25/26 - Status Update API
router.post('/cases/:id/evidence', policeEvidenceUploads, addEvidenceHQ);
router.put('/cases/:id/close', closeCaseHQ); // Screen 34 - Case Close API
router.post('/cases/:id/reassign', reassignCaseHQ); // Screen 4/29 - Re-assign API

// Send emergency reinforcement support request to other stations
router.post('/cases/:id/support-request', sendSupportRequest);
 
 
module.exports = router;
 