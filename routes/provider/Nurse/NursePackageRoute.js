const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { nursePackageUploads } = require('../../../middleware/multer');
const {
    getAllMasterServicesForSelection, 
    managePackage,
    getMyPackages,
    getConsumablesForPackage,
    getPackageDetails,
    deletePackage
} = require('../../../controllers/provider/Nurse/NursePackage');

// Base URL: /provider/nurse/package

// Dropdowns & Data Pickers
router.get('/nurse-services', protect('nurse'), getAllMasterServicesForSelection); 
router.get('/consumables', protect('nurse'), getConsumablesForPackage); // 👈 Added: Consumables Dropdown API

// CRUD Operations
router.get('/my-packages', protect('nurse'), getMyPackages);
router.get('/details/:id', protect('nurse'), getPackageDetails); // 👈 Added: Single Package Details
router.post('/manage', protect('nurse'), nursePackageUploads, managePackage); // Create
router.put('/manage/:id', protect('nurse'), nursePackageUploads, managePackage); // 👈 Added: Edit / Update
router.delete('/delete/:id', protect('nurse'), deletePackage); // 👈 Added: Delete Package

module.exports = router;