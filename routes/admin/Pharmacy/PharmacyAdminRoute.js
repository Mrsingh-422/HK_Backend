const express  = require('express');
const router  = express.Router();
const { protect,checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    adminGetPharmacyBookings,
        adminGetApprovedPharmacies,

} = require('../../../controllers/admin/Pharmacy/PharmacyAdmin');

// Base URL: /admin/pharmacy
router.use(protect('admin'));
 router.use(checkRoleAccess(5)); // Only admin with role access 5 can access these routes


router.get('/approved-list', adminGetApprovedPharmacies);
router.get('/bookings', adminGetPharmacyBookings);

module.exports = router;