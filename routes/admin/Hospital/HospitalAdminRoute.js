const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    updateHospitalRescheduleLimit,
    getHospitalRescheduleLimit,
    adminGetApprovedHospitals,
    adminGetHospitalBookings
} = require('../../../controllers/admin/Hospital/HospitalAdmin');

// Base URL: /admin/hospital

router.patch('/update-reschedule-limit', protect('admin'),checkRoleAccess(4), updateHospitalRescheduleLimit);
router.get('/reschedule-limit', protect('admin'), checkRoleAccess(4), getHospitalRescheduleLimit);

router.get('/approved-list', protect('admin'), checkRoleAccess(5), adminGetApprovedHospitals);
router.get('/appointments', protect('admin'), checkRoleAccess(4), adminGetHospitalBookings);


module.exports = router;