const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { driverDocUploads } = require('../../../middleware/multer');
const { registerDriver } = require('../../../controllers/provider/Nurse/DriverNurse');

// Base URL: /provider/nurse/driver

router.post('/add', protect('nurse'), driverDocUploads, registerDriver); 
// Note: Agal alag routes ke liye protect mein 'pharmacy' ya 'nurse' pass karein



module.exports = router;