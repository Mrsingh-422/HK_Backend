const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    adminGetNurseBookings,
    adminGetApprovedNurses,
    toggleActiveInactiveNurse
} = require('../../../controllers/admin/Nurse/NurseAdmin');

// Base URL: /admin/nurse

router.get('/approved-list', protect('admin'), checkRoleAccess(5), adminGetApprovedNurses);
router.get('/bookings', protect('admin'), checkRoleAccess(36), adminGetNurseBookings);
router.patch('/status/active-inactive/:nurseId', protect('admin'), checkRoleAccess(36), toggleActiveInactiveNurse);
 

module.exports = router;