// routes/admin/others/PolicyConfigRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware.js'); 
const { getPolicyConfigs, updateNoShowConfig, updateCancellationConfig,
    getCodConfigs, toggleCodStatus
 } = require('../../../controllers/admin/others/PolicyConfig.js');

// Base route: /api/admin/policy-config

// 1. Fetch all configurations for No-Show and Cancellations
router.get('/', protect('admin'), getPolicyConfigs);

// 2. Update or Upsert No-Show configurations
router.post('/no-show', protect('admin'), updateNoShowConfig);

// 3. Update or Upsert Cancellation configurations
router.post('/cancellation', protect('admin'), updateCancellationConfig);

// GET: Fetch COD configurations
router.get('/cod', protect('admin'), getCodConfigs);

// POST: Toggle COD configuration
router.post('/cod/toggle', protect('admin'), toggleCodStatus);

module.exports = router;