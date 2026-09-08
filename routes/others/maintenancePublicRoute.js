const express = require('express');
const router = express.Router();
const { getPublicMaintenanceStatus } = require('../../controllers/admin/others/MaintenanceController');

// Base URL: /api/maintenance/status
router.get('/status', getPublicMaintenanceStatus);

module.exports = router;