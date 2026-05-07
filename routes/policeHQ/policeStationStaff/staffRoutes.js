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
    submitLeave
} = require('../../../controllers/policeHQ/policeStationStaff/staffController');
 
// All routes are protected for 'police-staff' role
router.use(protect('police-staff'));
 
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
 
module.exports = router;
 