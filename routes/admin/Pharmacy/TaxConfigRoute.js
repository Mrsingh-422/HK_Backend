// routes/admin/Pharmacy/TaxConfigRoute.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { createHsnCode, getHsnCodes } = require('../../../controllers/admin/Pharmacy/TaxConfig');

// 1. Create HSN Code Master Entry (Admin Token Required)
router.post('/hsn/create', protect('admin'), createHsnCode);

// 2. Fetch all active HSN codes (TOKEN FREE - PUBLIC API)
router.get('/hsn/list', getHsnCodes);

module.exports = router;