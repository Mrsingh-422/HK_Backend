const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getAllDriversAdmin, 
    toggleDriverStatus, 
    getDriverDetails, 
    deleteDriverAdmin 
} = require('../../../controllers/admin/others/DriverVendor');

// Base URL: /admin/drivers/vendor

router.get('/list', protect('admin'), getAllDriversAdmin);
router.get('/details/:id', protect('admin'), getDriverDetails);
router.patch('/toggle/:id', protect('admin'), toggleDriverStatus);
router.delete('/delete/:id', protect('admin'), deleteDriverAdmin);

module.exports = router;