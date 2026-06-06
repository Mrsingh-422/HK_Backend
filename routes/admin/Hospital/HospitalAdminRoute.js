const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    updateHospitalRescheduleLimit,
    getHospitalRescheduleLimit,
    adminGetApprovedHospitals,
    adminGetHospitalBookings
} = require('../../../controllers/admin/Hospital/HospitalAdmin');

// Base URL: /admin/hospital

router.patch('/update-reschedule-limit', protect('admin'), updateHospitalRescheduleLimit);
router.get('/reschedule-limit', protect('admin'), getHospitalRescheduleLimit);

router.get('/approved-list', protect('admin'), adminGetApprovedHospitals);
router.get('/appointments', protect('admin'), adminGetHospitalBookings);


module.exports = router;