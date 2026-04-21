const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {  loginHQ, updateHQProfile  } = require('../../controllers/policeHQ/authPoliceHQ');

router.post('/login', loginHQ);
router.put('/update', protect('Police-Station-Staff'), updateHQProfile);


module.exports = router;