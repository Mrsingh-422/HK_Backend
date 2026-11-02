// Clean routes/policeHQ/policeStation/stationRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { policeStaffUploads, policeStationUploads, policeEvidenceUploads } = require('../../../middleware/multer');
const {
    getStationDashboard,
    addStaff,
    updateStaff,
    getStaffList,
    removeStaff,
    getStationCases,
    acceptCase,
    assignStaffToCase,
    updateCaseProgress,
    closeCase,
    getStaffRoster,
    manageLeaveRequest,
    getStationProfile,
    updateStationProfile,
    getPendingCases,
    getCaseHistory,
    getStationJurisdiction,
    updateStationPreferences,
    getRosterRequests,
    manageRosterRequest,
    getStationCaseHistoryFiltered,
    updateCaseStatusDetail,
    getNearbyStationsForCase,
    getStaffRosterDetailed,
    transferCaseToStation,
    updateCaseStatusStation,
    addEvidenceStation,
    closeCaseStation,
    getCaseSummaryStation,
    getStationNotifications,
    deleteStationNotification,
    requestBackupStation,
    getOfficerDetailedProfile,
    getRosterHistory,
    createStationCase,
    createStationNotification,
    markAllNotificationsRead,
    getStationAppContent,
    updateStationAppContent
} = require('../../../controllers/policeHQ/policeStation/stationController');

// Base URL: /policeStation/station
router.use(protect('police-station'));

/** DASHBOARD **/
router.get('/dashboard', getStationDashboard);

/** STAFF & ROSTER MANAGEMENT **/
router.get('/staff', getStaffList);
router.post('/staff', policeStaffUploads, addStaff);
router.put('/staff/:id', policeStaffUploads, updateStaff);
router.delete('/staff/:id', removeStaff);
router.get('/staff-roster', getStaffRosterDetailed); // 👈 Detailed Shift A/B Roster active
router.get('/staff/:id/profile', getOfficerDetailedProfile);

/** LEAVE & ROSTER REQUESTS **/
router.put('/leave/manage/:id', manageLeaveRequest);
router.get('/roster-requests', getRosterRequests);
router.put('/roster-requests/:id/manage', manageRosterRequest);
router.get('/roster-requests/history', getRosterHistory);

/** CASE MANAGEMENT **/
router.get('/cases', getStationCases);
router.post('/create-cases', createStationCase);
router.put('/cases/accept/:id', acceptCase);
router.post('/cases/assign-staff', assignStaffToCase);
router.put('/cases/progress/:id', updateCaseProgress);
router.put('/cases/close/:id', closeCase);
router.get('/pending', getPendingCases);
router.get('/history', getCaseHistory);
router.get('/case-history-filtered', getStationCaseHistoryFiltered);
router.put('/cases/:id/status-milestone', policeEvidenceUploads, updateCaseStatusDetail);
router.get('/cases/:id/nearby-stations', getNearbyStationsForCase);
router.post('/cases/:id/transfer', transferCaseToStation);
router.put('/cases/:id/update-status', updateCaseStatusStation);
router.post('/cases/:id/evidence', policeEvidenceUploads, addEvidenceStation);
router.put('/cases/:id/close-case', policeEvidenceUploads, closeCaseStation);
router.get('/cases/:id/summary', getCaseSummaryStation);
router.post('/cases/:id/request-support', requestBackupStation);

/** PROFILE, JURISDICTION & SETTINGS **/
router.get('/profile', getStationProfile);
router.put('/profile', policeStationUploads, updateStationProfile);
router.get('/jurisdiction', getStationJurisdiction);
router.patch('/preferences', updateStationPreferences);
router.get('/content/:type', getStationAppContent);
router.put('/content/:type', updateStationAppContent);

/** NOTIFICATIONS **/
router.get('/notifications', getStationNotifications);
router.post('/notifications', createStationNotification);
router.put('/notifications/mark-all-read', markAllNotificationsRead);
router.delete('/notifications/:id', deleteStationNotification);

module.exports = router;