const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { createHsnCode, getHsnCodes } = require('../../../controllers/admin/Pharmacy/TaxConfig');

// Base: /admin/pharmacy/tax-config

// 1. Create HSN Code Master Entry
router.post('/hsn/create', protect('admin'), createHsnCode);

// 2. Fetch all active HSN codes (For dropdown menu in Pharmacist Panel)
router.get('/hsn/list', getHsnCodes);

module.exports = router;