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
router.post('/upload-packages', protect('admin'), uploadExcel.single('file'),checkRoleAccess(29), uploadMasterPackages);

router.get('/list/:type', protect('admin'), checkRoleAccess(29), listMasterData); // type: test/package
router.post('/search', protect('admin'), checkRoleAccess(29), searchMasterData); // type: test/package
router.post('/create', protect('admin'), checkRoleAccess(29), createMasterData); // type: test/package
router.put('/edit/:type/:id', protect('admin'), checkRoleAccess(29), editMasterData);

// Approval System
router.get('/requests/pending', protect('admin'), checkRoleAccess(29), getPendingRequests);
router.put('/requests/approve/:requestId', protect('admin'), checkRoleAccess(29), approveRequest);



// not used
router.get('/master-tests', protect('admin'),checkRoleAccess(29), getMasterList);
router.get('/master-packages', protect('admin'),checkRoleAccess(29), getMasterPackages);


module.exports = router;