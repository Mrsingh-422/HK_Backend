const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { generateAadhaarOtp, verifyAadhaarOtp, finalizeAbhaCreation, getAbhaDetails } = require('../../../controllers/user/others/AbhaCard');

// base URL: /api/user/abha

// 5 Step process endpoints
router.post('/step3-generate-otp', protect('user'), generateAadhaarOtp);
router.post('/step4-verify-otp', protect('user'), verifyAadhaarOtp);
router.post('/step5-finalize', protect('user'), finalizeAbhaCreation);

router.get('/details', protect('user'), getAbhaDetails);

module.exports = router;