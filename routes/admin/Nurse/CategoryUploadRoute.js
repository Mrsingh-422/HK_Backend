const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { careCSVUpload } = require('../../../middleware/multer');
const { 
    uploadCareCSV, 
    uploadMasterConsumables,
    getCareCategories, 
    getCareSubCategories, 
    getCareDetails 
} = require('../../../controllers/admin/Nurse/CategoryUpload');

// Base URL: /admin/nurse-csv

// --- ADMIN UPLOAD ROUTES ---
// Postman Key for both: 'file'
router.post('/upload-services', protect('admin'), careCSVUpload, uploadCareCSV);
router.post('/upload-consumables', protect('admin'), careCSVUpload, uploadMasterConsumables);

// --- USER/NURSE LINKED ROUTES ---
router.get('/categories', getCareCategories);
router.get('/sub-categories', getCareSubCategories);
router.get('/details', getCareDetails);

module.exports = router;