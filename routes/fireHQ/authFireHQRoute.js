const express = require('express');
const router = express.Router();
const { protect, protectFire } = require('../../middleware/authMiddleware');
const { fireHQUploads } = require('../../middleware/multer');
const { registerHQ, loginHQ, updateHQProfile ,changePassword, loginFireAll,getProfile,updateProfile } = require('../../controllers/fireHQ/authFireHQ');

// base url : /fireHQ/auth

router.post('/register',protect('admin'), registerHQ);
router.post('/login', loginHQ);
router.put('/update', fireHQUploads , protect('fire-hq'), updateHQProfile);
router.put('/change-password', protect('fire-hq'), changePassword);

router.post('/login-all', loginFireAll); // New Route for Unified Login (HQ, Station, Staff)

router.get('/profile', protect('fire-hq'), getProfile);
router.put('/profile/update',  protect('fire-hq'), updateProfile);


module.exports = router;