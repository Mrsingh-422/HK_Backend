const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    adminGetApprovedAmbulances,
    adminGetAmbulanceBookings
} = require('../../../controllers/admin/Ambulance/AmbulanceAdmin');

// Base URL: /admin/ambulance
router.get('/approved-list', protect('admin'), adminGetApprovedAmbulances); // Approved vendors list
router.get('/bookings', protect('admin'), adminGetAmbulanceBookings); // Specific vendor orders

module.exports = router;