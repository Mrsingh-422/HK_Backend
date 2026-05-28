const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    updateDocRescheduleLimit,
        getDocRescheduleLimit
} = require('../../../controllers/admin/Doctor/DoctorAdmin');

// Base URL: /admin/doctor

router.post('/update-reschedule-limit', protect('admin'), updateDocRescheduleLimit);
router.get('/reschedule-limit', protect('admin'), getDocRescheduleLimit);

module.exports = router;