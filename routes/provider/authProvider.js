const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { registerProvider, loginProvider, updateProviderProfile } = require('../../controllers/provider/authProvider.js');

// Base route: /api/auth/provider

router.post('/register', registerProvider);
router.post('/login', loginProvider);
router.put('/update', protect('provider'), updateProviderProfile);

module.exports = router;