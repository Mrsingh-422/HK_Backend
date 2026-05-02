const express = require('express');
const router = express.Router();
const { protect, protectFire } = require('../../middleware/authMiddleware');
const { registerHQ, loginHQ, updateHQProfile ,changePassword, loginFireAll } = require('../../controllers/fireHQ/authFireHQ');

// base url : /fireHQ/auth

router.post('/register',protect('admin'), registerHQ);
router.post('/login', loginHQ);
router.put('/update', protect('fire-hq'), updateHQProfile);
router.put('/change-password', protect('fire-hq'), changePassword);

router.post('/login-all', loginFireAll); // New Route for Unified Login (HQ, Station, Staff)


module.exports = router;