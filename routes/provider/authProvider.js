const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { labDocUploads, pharmacyDocUploads, nurseDocUploads } = require('../../middleware/multer'); // Multer import
const { 
    registerProvider, 
    loginProvider, 
    uploadLabDocs, uploadPharmacyDocs, uploadNurseDocs,
    forgotPasswordProvider, resetPasswordProvider 
} = require('../../controllers/provider/authProvider.js');

// Base route: /api/auth/provider

// 1. Step 1: Register (Basic Info)
router.post('/register', registerProvider);

// 2. Step 2: Login (Get Token & check profileStatus)
router.post('/login', loginProvider);

router.post('/forgot-password', forgotPasswordProvider);
router.post('/reset-password', resetPasswordProvider);

// 3. Step 3: Complete Profile (Upload Documents)
// Lab
router.put('/upload-docs/lab', protect('lab'), labDocUploads, uploadLabDocs);
// Pharmacy
router.put('/upload-docs/pharmacy', protect('pharmacy'), pharmacyDocUploads, uploadPharmacyDocs);
// Nurse
router.put('/upload-docs/nurse', protect('nurse'), nurseDocUploads, uploadNurseDocs);



module.exports = router;