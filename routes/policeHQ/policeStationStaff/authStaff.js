const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const {  loginPoliceStaff, updatePoliceStaffProfile,changePassword  } = require('../../../controllers/policeHQ/policeStationStaff/authStaff');

// Base URL: /policeStationStaff/auth

router.post('/login', loginPoliceStaff);
router.put('/update', protect('Police-Station-Staff'), updatePoliceStaffProfile);
router.put('/change-password', protect('Police-Station-Staff'), changePassword);


module.exports = router;