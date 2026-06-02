const express  = require('express');
const router  = express.Router();
const { 
    adminGetPharmacyBookings
} = require('../../../controllers/admin/Pharmacy/PharmacyAdmin');

// Base URL: /admin/pharmacy

router.get('/bookings', adminGetPharmacyBookings);

module.exports = router;