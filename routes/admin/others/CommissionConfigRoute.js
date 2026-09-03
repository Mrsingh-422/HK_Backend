// routes/admin/others/CommissionConfigRoute.js
const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    getCommissionConfigs, 
    updateCommissionConfig 
} = require('../../../controllers/admin/others/CommissionConfig');

// Base URL: /api/admin/commission-config

router.get('/', protect('admin'), checkRoleAccess(39), getCommissionConfigs);
router.post('/update', protect('admin'), checkRoleAccess(39), updateCommissionConfig);

module.exports = router;