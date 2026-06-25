const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
   adminGetLabBookings,
   adminGetApprovedLabs
} = require('../../../controllers/admin/Lab/LabAdmin');

// Base URL: /admin/lab

router.get('/approved-list', protect('admin'), checkRoleAccess(5), adminGetApprovedLabs);
router.get('/bookings', protect('admin'), checkRoleAccess(5), adminGetLabBookings);

module.exports = router;