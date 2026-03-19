const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { labServiceUploads } = require('../../../middleware/multer'); 

const { 
    saveLabTest, 
    getMyTests, 
    saveLabPackage, 
    getMyPackages, 
    deleteService ,
    getMasterList, getMasterTestDetails

} = require('../../../controllers/provider/Lab/LabsService');

// Base URL: /provider/labs/services



// --- MASTER TESTS ---
router.get('/tests/master-tests', protect('lab'), getMasterList);
router.get('/tests/master-details/:masterTestId', protect('lab'), getMasterTestDetails);


// --- LAB TESTS (Pathology/Radiology) ---
router.post('/tests/save', protect('lab'), labServiceUploads, saveLabTest);
router.get('/tests/my-tests', protect('lab'), getMyTests);

// --- LAB PACKAGES ---
router.post('/packages/save', protect('lab'), labServiceUploads, saveLabPackage);
router.get('/packages/my-packages', protect('lab'), getMyPackages);

// --- DELETE ---
router.delete('/delete/:type/:id', protect('lab'), deleteService);

module.exports = router;