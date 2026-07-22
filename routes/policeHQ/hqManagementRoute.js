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

    sendSupportRequest,
    getCaseSummary,
    updateLegalProgress,
    markAllNotificationsRead,
    getNearbyPoliceStations,
    getOnHoldCases,
    getPoliceContent,
    updatePoliceContent,
    getStationJurisdiction,
    updateStationJurisdiction





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


router.get('/cases/:id/summary', getCaseSummary);

// Legal details / Court updates panel 
router.put('/cases/:id/legal-progress', updateLegalProgress);

// Screen 1 & 2: Mark all read action button
router.put('/notifications/mark-all-read', markAllNotificationsRead);

// Screen 29 & 30: Load nearby police stations using query ?lat=X&lng=Y
router.get('/stations/nearby', getNearbyPoliceStations);

// Screen 25: Load On Hold Cases tab explicitly
router.get('/cases/on-hold', getOnHoldCases);

// Settings content fetch route (Any verified role can read)
router.get('/content/:type', getPoliceContent);

// Settings content update route (Only Police-HQ edit access)
router.put('/content/:type', updatePoliceContent);
// Get Jurisdiction of a specific station
router.get('/stations/:id/jurisdiction', getStationJurisdiction);
 
// Update Jurisdiction (Form-Data for file upload support)
// 'areaDocument' wahi key name hai jisse frontend file bhejega
router.put('/stations/:id/jurisdiction', policeStationUploads, updateStationJurisdiction);
 
 
 
module.exports = router;
 