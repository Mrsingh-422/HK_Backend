const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    adminGetNurseBookings,
    adminGetApprovedNurses
} = require('../../../controllers/admin/Nurse/NurseAdmin');

// Base URL: /admin/nurse

router.get('/approved-list', protect('admin'), checkRoleAccess(5), adminGetApprovedNurses);
router.get('/bookings', protect('admin'), checkRoleAccess(5), adminGetNurseBookings);

module.exports = router;