const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    adminGetAmbulanceBookings
} = require('../../../controllers/admin/Ambulance/AmbulanceAdmin');

// Base URL: /admin/ambulance

router.get('/bookings', protect('admin'), adminGetAmbulanceBookings);

module.exports = router;