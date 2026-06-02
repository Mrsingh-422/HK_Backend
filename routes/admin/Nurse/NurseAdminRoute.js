const express = require('express');
const router = express.Router();
const { 
    adminGetNurseBookings
} = require('../../../controllers/admin/Nurse/NurseAdmin');

// Base URL: /admin/nurse

router.get('/bookings', adminGetNurseBookings);

module.exports = router;