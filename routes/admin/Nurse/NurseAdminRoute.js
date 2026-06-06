const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    adminGetNurseBookings,
    adminGetApprovedNurses
} = require('../../../controllers/admin/Nurse/NurseAdmin');

// Base URL: /admin/nurse

router.get('/approved-list', protect('admin'), adminGetApprovedNurses);
router.get('/bookings', adminGetNurseBookings);

module.exports = router;