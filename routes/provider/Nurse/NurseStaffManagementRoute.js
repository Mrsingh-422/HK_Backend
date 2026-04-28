const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getAvailableStaff, assignStaffToBooking, updateServiceProgress
} = require('../../../controllers/provider/Nurse/NurseStaffManagement');

// Base URL: /provider/nurse/management

router.get('/available-staff', protect('nurse'), getAvailableStaff);
router.post('/assign-staff', protect('nurse'), assignStaffToBooking);
router.put('/update-progress', protect('nurse'), updateServiceProgress);

module.exports = router;