const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { fireStaffUploads } = require('../../../middleware/multer');
const { checkIn,checkOut, applyForLeave, getMyAssignedCases,getStaffProfileDetails, getLeaveCategories } = require('../../../controllers/fireHQ/fireStationStaff/staffOps');

// Base URL: /fireStaff/ops

router.post('/check-in', protect('fire-staff'), checkIn);
router.post('/check-out', protect('fire-staff'), checkOut); // NEW
router.post('/apply-leave', protect('fire-staff'), fireStaffUploads, applyForLeave);
router.get('/my-cases', protect('fire-staff'), getMyAssignedCases);
router.get('/profile', protect('fire-staff'), getStaffProfileDetails);
router.get('/leave-categories', protect('fire-staff'), getLeaveCategories);
module.exports = router; 