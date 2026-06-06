const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
   adminGetLabBookings,
   adminGetApprovedLabs
} = require('../../../controllers/admin/Lab/LabAdmin');

// Base URL: /admin/lab

router.get('/approved-list', protect('admin'), adminGetApprovedLabs);
router.get('/bookings', protect('admin'), adminGetLabBookings);

module.exports = router;