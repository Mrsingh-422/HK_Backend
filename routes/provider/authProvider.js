const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { providerDocUploads } = require('../../middleware/multer'); // Multer import
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
// Iske liye Login token zaroori hai
router.put('/upload-docs', protect('provider'), providerDocUploads, uploadProviderDocs);

module.exports = router;