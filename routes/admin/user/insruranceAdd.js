const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
// routes/adminRoutes.js
const { addInsurance, getInsuranceList } = require('../../../controllers/admin/user/insuranceAdd');


// Admin only: Add RGHS, CGHS, etc.
router.post('/add-insurance', protect('admin'), addInsurance);

// Public/User: Get Dropdown List
router.get('/insurance-list', getInsuranceList);

module.exports = router;