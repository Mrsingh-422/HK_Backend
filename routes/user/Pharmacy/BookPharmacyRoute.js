const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { getPharmacies, getPharmacyDetails } = require('../../../controllers/user/Pharmacy/BookPharmacy');

// Base URL: /user/pharmacy

router.post('/list', getPharmacies); // Search & Filter
router.get('/details/:id', getPharmacyDetails); // Profile Detail

module.exports = router;