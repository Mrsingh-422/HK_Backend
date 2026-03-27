const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { uploadExcel } = require('../../../middleware/multer'); 
const { uploadMasterTests, getMasterList, uploadMasterPackages, getMasterPackages,
    listMasterData, searchMasterData, createMasterData, editMasterData,
                    getPendingRequests, approveRequest
 } = require('../../../controllers/admin/Lab/TestUpload');

// Base URL: /admin/lab/tests
// checkrRoleAccess 29 = lab vendor
router.post('/upload', protect('admin'), uploadExcel.single('file'),checkRoleAccess(29), uploadMasterTests);
router.get('/master-tests', protect('admin'),checkRoleAccess(29), getMasterList);

router.post('/upload-packages', protect('admin'), uploadExcel.single('file'),checkRoleAccess(29), uploadMasterPackages);
router.get('/master-packages', protect('admin'),checkRoleAccess(29), getMasterPackages);


router.get('/list/:type', protect('admin'), listMasterData); // type: test/package
router.post('/search', protect('admin'), searchMasterData);
router.post('/create', protect('admin'), createMasterData);
router.put('/edit/:type/:id', protect('admin'), editMasterData);

// Approval System
router.get('/requests/pending', protect('admin'), getPendingRequests);
router.put('/requests/approve/:requestId', protect('admin'), approveRequest);

module.exports = router;