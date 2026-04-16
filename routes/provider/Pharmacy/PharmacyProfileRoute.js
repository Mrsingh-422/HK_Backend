const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { pharmacyDocUploads } = require('../../../middleware/multer');
const { getPharmacyProfile, updatePharmacyProfile, getMyMedicines } = require('../../../controllers/provider/Pharmacy/PharmacyProfile');

// Base URL: /provider/pharmacy/profile

// GET Request to fetch own profile
router.get('/', protect('pharmacy'), getPharmacyProfile);

// PUT Request to update own profile
router.put('/update', protect('pharmacy'),pharmacyDocUploads, updatePharmacyProfile);

// GET Request to fetch own medicines
router.get('/medicines', protect('pharmacy'), getMyMedicines);

module.exports = router;