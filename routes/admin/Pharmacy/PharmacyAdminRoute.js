const express  = require('express');
const router  = express.Router();
const { protect,checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    adminGetPharmacyBookings,
        adminGetApprovedPharmacies,
        toggleActiveInactivePharmacy

} = require('../../../controllers/admin/Pharmacy/PharmacyAdmin');

// Base URL: /admin/pharmacy

router.get('/approved-list', protect('admin'), checkRoleAccess(5), adminGetApprovedPharmacies);
router.get('/bookings', protect('admin'), checkRoleAccess(5), adminGetPharmacyBookings);
router.patch('/status/active-inactive/:pharmacyId', protect('admin'), checkRoleAccess(5), toggleActiveInactivePharmacy);

module.exports = router;