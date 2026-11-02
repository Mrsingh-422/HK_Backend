const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const {  loginPoliceStaff, updatePoliceStaffProfile,changePassword  } = require('../../../controllers/policeHQ/policeStationStaff/authStaff');

// Base URL: /policeStationStaff/auth

router.post('/login', loginPoliceStaff);
router.put('/update', protect('police-staff'), updatePoliceStaffProfile);
router.put('/change-password', protect('police-staff'), changePassword);


module.exports = router;