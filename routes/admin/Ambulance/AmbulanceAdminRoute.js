const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    adminGetApprovedAmbulances,
    adminGetAmbulanceBookings
} = require('../../../controllers/admin/Ambulance/AmbulanceAdmin');

// Base URL: /admin/ambulance
router.get('/approved-list', protect('admin'), checkRoleAccess(5),adminGetApprovedAmbulances); // Approved vendors list
router.get('/bookings', protect('admin'), checkRoleAccess(39), adminGetAmbulanceBookings); // Specific vendor orders

module.exports = router;