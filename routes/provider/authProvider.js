const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { labDocUploads, pharmacyDocUploads, nurseDocUploads } = require('../../middleware/multer'); // Multer import
const { 
    registerProvider, 
    loginProvider, 
    uploadProviderDocs // Naya function jo documents handle karega
} = require('../../controllers/provider/authProvider.js');

// Base route: /api/auth/provider

// 1. Step 1: Register (Basic Info)
router.post('/register', registerProvider);

// 2. Step 2: Login (Get Token & check profileStatus)
router.post('/login', loginProvider);

// 3. Step 3: Complete Profile (Upload Documents)
// login token necessary
// Lab
router.put('/upload-docs/lab', protect('Lab'), labDocUploads, uploadProviderDocs);

// Pharmacy 
router.put('/upload-docs/pharmacy', protect('Pharmacy'), pharmacyDocUploads, uploadProviderDocs);

// Nurse
router.put('/upload-docs/nurse', protect('Nurse'), nurseDocUploads, uploadProviderDocs);

module.exports = router;