const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { uploadExcel } = require('../../../middleware/multer'); 
const { uploadMasterTests, getMasterList } = require('../../../controllers/admin/Lab/TestUpload');

// Base URL: /admin/lab/tests
// checkrRoleAccess 29 = lab vendor
router.post('/upload', protect('admin'), uploadExcel.single('file'),checkRoleAccess(29), uploadMasterTests);
router.get('/master-tests', protect('admin'),checkRoleAccess(29), getMasterList);

module.exports = router;