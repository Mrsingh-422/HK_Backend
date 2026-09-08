const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { maintenanceUpload } = require('../../../middleware/multer');
const { 
    getAdminMaintenanceConfig, 
    updateMaintenanceConfig 
} = require('../../../controllers/admin/others/MaintenanceController');

// Base URL: /api/admin/maintenance
router.get('/', protect('admin'), getAdminMaintenanceConfig);
router.post('/', protect('admin'), maintenanceUpload, updateMaintenanceConfig);

module.exports = router;