const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { policeStaffUploads, policeStationUploads,policeEvidenceUploads } = require('../../../middleware/multer');
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
    getNearbyStationsForCase,getStaffRosterDetailed,transferCaseToStation,
    updateCaseStatusStation,
    addEvidenceStation,
    closeCaseStation,
    getCaseSummaryStation,
    getStationNotifications,
    deleteStationNotification,
    requestBackupStation,
    getOfficerDetailedProfile,
    getRosterHistory,
    createStationCase, createStationNotification,
    markAllNotificationsRead ,
    getStationAppContent,
    updateStationAppContent
 

} = require('../../../controllers/policeHQ/policeStation/stationController');
const { create } = require('../../../models/Admin');

// Base URL: /policeStation/station
 
// All routes require 'police-station' role
router.use(protect('police-station'));
 
/** DASHBOARD **/
router.get('/dashboard', getStationDashboard); // Screen 1
 
/** STAFF MANAGEMENT **/
router.get('/staff', getStaffList); // Screen 13, 24, 25
router.post('/staff', policeStaffUploads, addStaff); // Screen 15
router.put('/staff/:id', policeStaffUploads, updateStaff); // Screen 14 (Edit)
router.delete('/staff/:id', removeStaff); // Screen 16 (Remove with reason)
router.get('/staff-roster', getStaffRoster); // Screen 2
 
/** LEAVE MANAGEMENT **/
// Handle Screen 8, 9, 10
router.put('/leave/manage/:id', manageLeaveRequest);
 
/** CASE MANAGEMENT **/
router.get('/cases', getStationCases); // Screen 4
router.put('/cases/accept/:id', acceptCase); // Screen 4 (Accept btn)
router.post('/cases/assign-staff', assignStaffToCase); // Screen 24, 25, 26
router.put('/cases/progress/:id', updateCaseProgress); // Screen 11 (Progress dots)
router.put('/cases/close/:id', closeCase); // Screen 11 (Close btn)
 
/** PROFILE & JURISDICTION **/
router.get('/profile', getStationProfile); // Screen 17, 19
router.put('/profile', policeStationUploads, updateStationProfile); // Screen 18, 21
router.get('/pending', getPendingCases);
router.get('/history', getCaseHistory);

// new 
// Figma Screen 21: Jurisdiction details maps & boundary beats
router.get('/jurisdiction', getStationJurisdiction);

// Figma Screen 36: Toggle notification & broadcast preferences
router.patch('/preferences', updateStationPreferences);

// Figma Screen 32: Requests overview list tab (All, Leaves, Shift changes)
router.get('/roster-requests', getRosterRequests);

// Figma Screen 8/10: Process approve / reject leave or shift request
router.put('/roster-requests/:id/manage', manageRosterRequest);

// Figma Screen 12: Split Case History based on tabs (Closed vs Transferred)
router.get('/case-history-filtered', getStationCaseHistoryFiltered);

// Figma Screen 17 & 40: Update specific case milestone status with file attachment
router.put('/cases/:id/status-milestone', policeEvidenceUploads, updateCaseStatusDetail);

// Figma Screen 9: Search nearby backup stations coordinates tracking
router.get('/cases/:id/nearby-stations', getNearbyStationsForCase);

// 🚨 Screen 39: Replace your old roster route with this detailed shift roster route
router.get('/staff-roster', getStaffRosterDetailed);

// 🚨 Screen 12 & 45: Submit Case Transfer request
router.post('/cases/:id/transfer', transferCaseToStation);
// 1. Screen 17 & 40: Update Status Checklist & Remarks
router.put('/cases/:id/update-status', updateCaseStatusStation);

// 2. Screen 8: Upload evidence with dynamic files and details
router.post('/cases/:id/evidence', policeEvidenceUploads, addEvidenceStation);

// 3. Screen 11 & 40: Close Case with remarks dropdown and report file upload
router.put('/cases/:id/close-case', policeEvidenceUploads, closeCaseStation);
// new
// Figma Screen 21: Jurisdiction details maps & boundary beats
router.get('/jurisdiction', getStationJurisdiction);
 
// Figma Screen 36: Toggle notification & broadcast preferences
router.patch('/preferences', updateStationPreferences);
 
// Figma Screen 32: Requests overview list tab (All, Leaves, Shift changes)
router.get('/roster-requests', getRosterRequests);
 
// Figma Screen 8/10: Process approve / reject leave or shift request
router.put('/roster-requests/:id/manage', manageRosterRequest);
 
// Figma Screen 12: Split Case History based on tabs (Closed vs Transferred)
router.get('/case-history-filtered', getStationCaseHistoryFiltered);
 
// Figma Screen 17 & 40: Update specific case milestone status with file attachment
router.put('/cases/:id/status-milestone', policeEvidenceUploads, updateCaseStatusDetail);
 
// Figma Screen 9: Search nearby backup stations coordinates tracking
router.get('/cases/:id/nearby-stations', getNearbyStationsForCase);
 
// 🚨 Screen 39: Replace your old roster route with this detailed shift roster route
router.get('/staff-roster', getStaffRosterDetailed);
 
// 🚨 Screen 12 & 45: Submit Case Transfer request
router.post('/cases/:id/transfer', transferCaseToStation);
// 1. Screen 17 & 40: Update Status Checklist & Remarks
router.put('/cases/:id/update-status', updateCaseStatusStation);
 
// 2. Screen 8: Upload evidence with dynamic files and details
router.post('/cases/:id/evidence', policeEvidenceUploads, addEvidenceStation);
 
// 3. Screen 11 & 40: Close Case with remarks dropdown and report file upload
router.put('/cases/:id/close-case', policeEvidenceUploads, closeCaseStation);
// --- MISSING ROUTES ADDED ---
 
// Case Summary
router.get('/cases/:id/summary', getCaseSummaryStation);
 
// Notifications
router.get('/notifications', getStationNotifications);
router.delete('/notifications/:id', deleteStationNotification);
 
// Support Request (Backup)
router.post('/cases/:id/request-support', requestBackupStation);
 
// Officer Profile Detail
router.get('/staff/:id/profile', getOfficerDetailedProfile);
// 1. Create Request (For Postman Testing)
router.get('/roster-requests/history', getRosterHistory);
router.post('/create-cases', createStationCase);
// 1. Create a notification (POST)
router.post('/notifications', createStationNotification);
 
// 2. Mark all as read (PUT) - Ensure this is placed BEFORE /notifications/:id if you had it, to avoid route conflict
router.put('/notifications/mark-all-read', markAllNotificationsRead);
// Documentation & Support Routes
router.get('/content/:type', getStationAppContent);
router.put('/content/:type', updateStationAppContent);
 
 
 
module.exports = router;
 