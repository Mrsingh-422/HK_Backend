const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { driverDocUploads } = require('../../../middleware/multer');
const { registerDriver, loginDriver } = require('../../../controllers/provider/Common/Driver');

// --- Base URL: /api/provider/drivers ---

/**
 * @desc    Vendor (Lab/Pharmacy/Nurse) apne drivers add karega
 * @note    Yahan 'lab', 'pharmacy', ya 'nurse' pass karna zaroori hai 
 *          taaki middleware sahi model uthaye.
 */
router.post('/add', protect('lab'), driverDocUploads, registerDriver); 
// Note: Agal alag routes ke liye protect mein 'pharmacy' ya 'nurse' pass karein

/**
 * @desc    Driver khud login karega
 * @note    Driver ka apna alag role/collection hai
 */
router.post('/login', loginDriver);

module.exports = router;