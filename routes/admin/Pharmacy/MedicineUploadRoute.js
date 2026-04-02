const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { uploadExcel } = require('../../../middleware/multer');
const { 
    uploadMedicinesExcel, 
    getMedicinesList, 
    searchMedicines, // Nayi Search API
    createMedicine, 
    updateMedicine, 
    deleteMedicine, 
    getMedicineDetails 
} = require('../../../controllers/admin/Pharmacy/MedicineUpload');

// base URL: /admin/pharmacy/medicines

// --- Create ---
router.post('/upload', protect('admin'), checkRoleAccess(28), uploadExcel.single('file'), uploadMedicinesExcel);
router.post('/create', protect('admin'), checkRoleAccess(28), createMedicine);

// --- Read (GET for List & Details) ---
router.get('/list', getMedicinesList); // Example: /list?page=1 (Limit fixed to 20)
router.get('/details/:id', getMedicineDetails);

// --- Search (POST for advanced filtering) ---
router.post('/search', searchMedicines); // Body: { "search": "paracetamol", "page": 1 }

// --- Update & Delete ---
router.put('/update/:id', protect('admin'), checkRoleAccess(28), updateMedicine);
router.delete('/delete/:id', protect('admin'), checkRoleAccess(28), deleteMedicine);

module.exports = router;