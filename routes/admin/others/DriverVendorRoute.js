const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    getAllDriversAdmin, 
    toggleDriverStatus, 
    getDriverDetails, 
    deleteDriverAdmin 
} = require('../../../controllers/admin/others/DriverVendor');

// Base URL: /admin/drivers/vendor

router.get('/list', protect('admin'), checkRoleAccess(3),getAllDriversAdmin);
router.get('/details/:id', protect('admin'), checkRoleAccess(3),getDriverDetails);
router.patch('/toggle/:id', protect('admin'),  checkRoleAccess(3),toggleDriverStatus);
router.delete('/delete/:id', protect('admin'), checkRoleAccess(3), deleteDriverAdmin);

module.exports = router;