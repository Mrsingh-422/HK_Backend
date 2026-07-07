const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
   adminGetLabBookings,
   adminGetApprovedLabs,
   toggleActiveInactiveLab
} = require('../../../controllers/admin/Lab/LabAdmin');

// Base URL: /admin/lab

router.get('/approved-list', protect('admin'), checkRoleAccess(5), adminGetApprovedLabs);
router.get('/bookings', protect('admin'), checkRoleAccess(5), adminGetLabBookings);
router.patch('/status/active-inactive/:labId', protect('admin'), checkRoleAccess(5), toggleActiveInactiveLab);
 

module.exports = router;