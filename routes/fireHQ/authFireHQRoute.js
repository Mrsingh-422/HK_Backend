const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { registerHQ, loginHQ, updateHQProfile  } = require('../../controllers/fireHQ/authFireHQ');

// base url : /fireHQ/auth

router.post('/register',protect('admin'), registerHQ);
router.post('/login', loginHQ);
router.put('/update', protect('Fire-HQ'), updateHQProfile);


module.exports = router;