const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { policeStaffUploads, policeStationUploads } = require('../../../middleware/multer');
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
    getCaseHistory

} = require('../../../controllers/policeHQ/policeStation/stationController');

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
 
module.exports = router;
 