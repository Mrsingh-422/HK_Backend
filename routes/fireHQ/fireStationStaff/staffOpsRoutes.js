const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { fireStaffUploads,fireLeaveUploads } = require('../../../middleware/multer');
const { checkIn,checkOut, applyForLeave, getMyAssignedCases,getStaffProfileDetails, getLeaveCategories,
        submitWorkRequest, updateIncidentProgress, getStaffNotifications,
        getStaffDashboard, getFreshCases , getCaseDetails, getAcceptedCases,getIncidentHistoryAll,getIncidentHistory,markAllNotificationsRead,
         acceptCase, requestBackup
 } = require('../../../controllers/fireHQ/fireStationStaff/staffOps');

// Base URL: /fireStaff/ops

router.post('/check-in', protect('fire-staff'), checkIn);
router.post('/check-out', protect('fire-staff'), checkOut); // NEW
router.post('/apply-leave', protect('fire-staff'), fireLeaveUploads, applyForLeave);
router.get('/my-cases', protect('fire-staff'), getMyAssignedCases);
router.get('/profile', protect('fire-staff'), getStaffProfileDetails);
router.get('/leave-categories', protect('fire-staff'), getLeaveCategories);

router.post('/work-request', protect('fire-staff'), submitWorkRequest); // Screen 15
router.put('/update-progress', protect('fire-staff'), updateIncidentProgress); // Screen 100
router.get('/notifications', protect('fire-staff'), getStaffNotifications); // Screen 16
router.put('/notifications/mark-all-read', protect('fire-staff'), markAllNotificationsRead); // Screen 16





router.get('/dashboard', protect('fire-staff'), getStaffDashboard); // Screen 17
router.get('/cases/fresh', protect('fire-staff'), getFreshCases); // Screen 18
router.get('/cases/ongoing', protect('fire-staff'), getAcceptedCases); // Screen 20
router.get('/cases/history', protect('fire-staff'), getIncidentHistoryAll); // Screen 102 - All History
router.get('/cases/:id', protect('fire-staff'), getCaseDetails); // Screen 19
router.get('/cases/history/:id', protect('fire-staff'), getIncidentHistory); 
router.put('/cases/:id/accept', protect('fire-staff'), acceptCase); // Screen 21
router.post('/cases/request-backup', protect('fire-staff'), requestBackup); // Screen 22
module.exports = router; 