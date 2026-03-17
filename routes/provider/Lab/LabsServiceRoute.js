const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { labServiceUploads } = require('../../../middleware/multer'); // Same Multer for Lab Services
const { saveLabTest, saveLabPackage, deleteService } = require('../../../controllers/provider/Lab/LabsService');

// Base URL: /provider/labs/services

// PROTECTED (Requires Provider token)
router.post('/add-test', protect('provider'), labServiceUploads, saveLabTest);
router.post('/add-package', protect('provider'), labServiceUploads, saveLabPackage);
router.delete('/delete-service/:type/:id', protect('provider'), deleteService);

module.exports = router;