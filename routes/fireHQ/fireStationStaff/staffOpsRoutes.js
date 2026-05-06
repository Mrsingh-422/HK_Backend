const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { fireStaffUploads,fireLeaveUploads } = require('../../../middleware/multer');
const { checkIn,checkOut, applyForLeave, getMyAssignedCases,getStaffProfileDetails, getLeaveCategories,
        submitWorkRequest, updateIncidentProgress, getStaffNotifications
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
module.exports = router; 