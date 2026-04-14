const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');

// Note: Agar aapne multer config me sirf '.xlsx' allowed rakha tha, 
// toh usme '.csv' / '.txt' allow zaroor kar dena.
const { uploadExcel } = require('../../../middleware/multer'); 

const { 
    uploadMedicinesCSV, // Name updated for clarity
    getMedicinesList, 
    searchMedicines, 
    createMedicine, 
    updateMedicine, 
    deleteMedicine, 
    getMedicineDetails 
} = require('../../../controllers/admin/Pharmacy/MedicineUpload');

// base URL: /admin/pharmacy/medicines

// --- Create (Bulk & Single) ---
// File upload for bulk processing (CSV/TSV recommended for large data)
router.post('/upload', protect('admin'), checkRoleAccess(28), uploadExcel.single('file'), uploadMedicinesCSV);

// Manual single creation
router.post('/create', protect('admin'), checkRoleAccess(28), createMedicine);

// --- Read (GET for List & Details) ---
// Pagination with fixed limit = 20 (Example: /list?page=1)
router.get('/list', getMedicinesList); 

// Get Details of a single medicine
router.get('/details/:id', getMedicineDetails);

// --- Search (POST for advanced filtering) ---
// Body: { "search": "paracetamol", "page": 1 }
router.post('/search', searchMedicines); 

// --- Update & Delete ---
router.put('/update/:id', protect('admin'), checkRoleAccess(28), updateMedicine);
router.delete('/delete/:id', protect('admin'), checkRoleAccess(28), deleteMedicine);

module.exports = router;