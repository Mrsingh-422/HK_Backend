const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    adminGetApprovedAmbulances,
    adminGetAmbulanceBookings,
    toggleActiveInactiveAmbulance,
    adminGetAllAmbulances
} = require('../../../controllers/admin/Ambulance/AmbulanceAdmin');

// Base URL: /admin/ambulance
router.get('/approved-list', protect('admin'), checkRoleAccess(5),adminGetApprovedAmbulances); // Approved vendors list
router.get('/bookings', protect('admin'), checkRoleAccess(39), adminGetAmbulanceBookings); // Specific vendor orders
router.patch('/status/active-inactive/:ambulanceId', protect('admin'), checkRoleAccess(39), toggleActiveInactiveAmbulance); // Toggle ambulance status
router.get('/ambulance-lists', protect('admin'), checkRoleAccess(39),adminGetAllAmbulances); // Ambulance list ALL
 

module.exports = router;