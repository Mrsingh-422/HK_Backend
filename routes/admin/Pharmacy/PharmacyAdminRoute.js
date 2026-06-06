const express  = require('express');
const router  = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    adminGetPharmacyBookings,
        adminGetApprovedPharmacies,

} = require('../../../controllers/admin/Pharmacy/PharmacyAdmin');

// Base URL: /admin/pharmacy

router.get('/approved-list', protect('admin'), adminGetApprovedPharmacies);
router.get('/bookings', adminGetPharmacyBookings);

module.exports = router;