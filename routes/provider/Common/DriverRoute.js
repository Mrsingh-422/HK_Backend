const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { driverDocUploads } = require('../../../middleware/multer'); // Ensure path is correct
const { registerDriver, loginDriver } = require('../../../controllers/provider/Common/Driver');

// Base URL: /provider/driver 

// 1. ADD DRIVER (Vendor Panel: Lab/Pharma/Nurse access this)
// Vendor log-in hoga, tabhi driver add kar payega
router.post('/add', protect('provider'), driverDocUploads, registerDriver);

// 2. LOGIN DRIVER (Driver khud login karega)
router.post('/login', loginDriver);

module.exports = router;