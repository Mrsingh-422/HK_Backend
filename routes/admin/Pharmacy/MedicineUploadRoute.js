const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { uploadExcel } = require('../../../middleware/multer');
const { uploadMedicinesExcel, getMedicinesList, createMedicine } = require('../../../controllers/admin/Pharmacy/MedicineUpload');

// Base URL: /admin/pharmacy/medicine

// 1. Upload Excel File (Admin only)
// Note: 'file' yahan form-data ki key ka naam hai
router.post('/upload', protect('admin'), checkRoleAccess(28), uploadExcel.single('file'), uploadMedicinesExcel);
router.post('/create', protect('admin'), checkRoleAccess(28), createMedicine);


// 2. Get Medicines List (Admin & App Users can access)
router.get('/list', getMedicinesList); 

module.exports = router;