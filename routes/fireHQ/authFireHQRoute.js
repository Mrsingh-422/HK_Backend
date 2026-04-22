const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { registerHQ, loginHQ, updateHQProfile ,changePassword } = require('../../controllers/fireHQ/authFireHQ');

// base url : /fireHQ/auth

router.post('/register',protect('admin'), registerHQ);
router.post('/login', loginHQ);
router.put('/update', protect('fire-hq'), updateHQProfile);
router.put('/change-password', protect('fire-hq'), changePassword);


module.exports = router;