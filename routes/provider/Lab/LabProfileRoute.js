const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
// ✅ MULTER IMPORT FIX: Ensure ye wahi naam hai jo middleware/upload.js mein export kiya hai
const { labDocUploads } = require('../../../middleware/multer'); 

const { getLabProfile, updateLabProfile, getMyAllServices } = require('../../../controllers/provider/Lab/LabProfile');

// Base URL: /provider/labs/profile

router.get('/', protect('lab'), getLabProfile);

router.put('/update', protect('lab'), labDocUploads, updateLabProfile);

router.get('/services/all', protect('lab'), getMyAllServices);

module.exports = router;