const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { registerHQ, loginHQ, updatePoliceHQProfile } = require('../../controllers/policeHQ/authPoliceHQ');

router.post('/register', protect('admin'), registerHQ);
router.post('/login', loginHQ);
router.put('/update', protect('Police-HQ'), updatePoliceHQProfile);

module.exports = router;