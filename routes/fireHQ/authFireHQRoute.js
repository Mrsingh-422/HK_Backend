const express = require('express');
const router = express.Router();
const { protect, protectFire } = require('../../middleware/authMiddleware');
const { fireHQUploads } = require('../../middleware/multer');
const { registerHQ, loginHQ, updateHQProfile ,getLatestFireHQProfileRequest,changePassword, loginFireAll,getProfile } = require('../../controllers/fireHQ/authFireHQ');

// base url : /fireHQ/auth

router.post('/register',protect('admin'), registerHQ);
router.post('/login', loginHQ);
router.put('/update', fireHQUploads , protect('fire-hq'), updateHQProfile);
router.get('/profile/update-status', protect('fire-hq'), getLatestFireHQProfileRequest);

router.put('/change-password', protect('fire-hq'), changePassword);

router.post('/login-all', loginFireAll); // New Route for Unified Login (HQ, Station, Staff)

router.get('/profile', protect('fire-hq'), getProfile);


module.exports = router;