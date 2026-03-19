const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { driverDocUploads } = require('../../../middleware/multer');

const { registerDriver, loginDriver } = require('../../../controllers/provider/Common/Driver');

// Base URL: /provider/driver

/**
 * @desc    Driver khud login karega
 * @note    Driver ka apna alag role/collection hai
 */
router.post('/login', loginDriver);

module.exports = router;