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
    getMasterList, getMasterTestDetails, getStandardCatalogTests, getStandardPackages,getMasterPackages,getMasterPackageDetails,
    submitNewMasterRequest

} = require('../../../controllers/provider/Lab/LabsService');

// Base URL: /provider/labs/services

// List all standard tests/packages
router.get('/tests/standard-catalog', getStandardCatalogTests);
router.get('/packages/standard-catalog', getStandardPackages);



// --- MASTER TESTS ---
router.get('/tests/master-tests', protect('lab'), getMasterList);
router.get('/tests/master-details/:masterTestId', protect('lab'), getMasterTestDetails);
router.get('/packages/master-packages', protect('lab'), getMasterPackages);
router.get('/packages/master-details/:id', protect('lab'), getMasterPackageDetails);



// --- LAB TESTS (Pathology/Radiology) ---
router.post('/tests/save', protect('lab'), labServiceUploads, saveLabTest);  
router.get('/tests/my-tests', protect('lab'), getMyTests);

// --- LAB PACKAGES ---
router.post('/packages/save', protect('lab'), labServiceUploads, saveLabPackage);
router.get('/packages/my-packages', protect('lab'), getMyPackages);

// --- DELETE ---
router.delete('/delete/:type/:id', protect('lab'), deleteService);

router.post('/suggest-new', protect('lab'), submitNewMasterRequest);

module.exports = router;  