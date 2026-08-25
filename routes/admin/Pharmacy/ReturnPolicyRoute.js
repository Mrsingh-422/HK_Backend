const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { getReturnPolicyConfig, updateReturnPolicyConfig } = require('../../../controllers/admin/Pharmacy/ReturnPolicy');

// Base: /admin/pharmacy/return-policy

router.get('/return-policy', protect('admin'), getReturnPolicyConfig);
router.put('/return-policy/update', protect('admin'), updateReturnPolicyConfig);

module.exports = router;