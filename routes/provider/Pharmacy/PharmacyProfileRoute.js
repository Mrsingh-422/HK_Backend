const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { getPharmacyProfile } = require('../../../controllers/provider/Pharmacy/PharmacyProfile');

// Base URL: /provider/pharmacy/profile

// GET Request to fetch own profile
router.get('/', protect('pharmacy'), getPharmacyProfile);

module.exports = router;