
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { driverDocUploads } = require('../../../middleware/multer');
const { 
    registerDriver, 
    loginDriver, 
    getVendorDrivers, 
    searchDrivers, 
    getDriverById, 
    updateDriver, 
    deleteDriver,
    toggleDriverStatus,
    vendorResetDriverPassword
} = require('../../../controllers/provider/Common/Driver');

// Base URL: /provider/driver 


// --- Public ---
router.post('/login', loginDriver);

// --- Protected (Vendor Only) ---
router.post('/add', protect('provider'), driverDocUploads, registerDriver);
router.get('/list', protect('provider'), getVendorDrivers); // /list?page=1
router.post('/search', protect('provider'), searchDrivers); // Search via POST body
router.get('/details/:id', protect('provider'), getDriverById);
router.put('/update/:id', protect('provider'), driverDocUploads, updateDriver); // Multi-role access
router.delete('/delete/:id', protect('provider'), deleteDriver);
router.patch('/status/:id', protect('provider'), toggleDriverStatus); // To change availability
router.put('/reset-password/:id', protect('provider'), vendorResetDriverPassword);

module.exports = router;