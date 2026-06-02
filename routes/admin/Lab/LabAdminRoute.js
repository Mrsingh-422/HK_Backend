const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
   adminGetLabBookings
} = require('../../../controllers/admin/Lab/LabAdmin');

// Base URL: /admin/lab

router.get('/bookings', protect('admin'), adminGetLabBookings);

module.exports = router;