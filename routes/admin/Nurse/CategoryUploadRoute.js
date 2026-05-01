const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { careCSVUpload } = require('../../../middleware/multer');
const { 
    uploadCareCSV, 
    getCareCategories, 
    getCareSubCategories, 
    getCareDetails 
} = require('../../../controllers/admin/Nurse/CategoryUpload');

// Base URL: /admin/nurse-csv

// 1. CSV Upload Route (Admin Only)

// Admin Route (Upload)
router.post('/upload', protect('admin'), careCSVUpload, uploadCareCSV);

// Public/User Routes (For Flutter Linked Dropdowns)
router.get('/categories', getCareCategories);
router.get('/sub-categories', getCareSubCategories); // ?category=Home Nursing
router.get('/details', getCareDetails); // ?category=...&subCategory=...

module.exports = router;