const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { registerPoliceHQ, loginPoliceHQ, updatePoliceHQProfile } = require('../../controllers/policeHQ/authPoliceHQ');

// Base URL: /policeHQ/auth

router.post('/register', protect('admin'), registerPoliceHQ);
router.post('/login', loginPoliceHQ);
router.put('/update', protect('Police-HQ'), updatePoliceHQProfile);

module.exports = router;