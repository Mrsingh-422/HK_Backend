const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { generateAadhaarOtp, verifyAadhaarOtp } = require('../../../controllers/user/others/AbhaCard');

router.post('/generate-otp', protect('user'), generateAadhaarOtp);
router.post('/verify-otp', protect('user'), verifyAadhaarOtp);

module.exports = router;