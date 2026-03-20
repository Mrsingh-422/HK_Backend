const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { driverDocUploads } = require('../../../middleware/multer');
const { registerDriver } = require('../../../controllers/provider/Pharmacy/DriverPharmacy');

// Base URL: /provider/pharmacy/driver

router.post('/add', protect('pharmacy'), driverDocUploads, registerDriver); 
// Note: Agal alag routes ke liye protect mein 'pharmacy' ya 'nurse' pass karein



module.exports = router;