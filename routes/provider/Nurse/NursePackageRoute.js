const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { nursePackageUploads } = require('../../../middleware/multer');
const {getAllMasterServicesForSelection, managePackage,getMyPackages} = require('../../../controllers/provider/Nurse/NursePackage');

// Base URL: /provider/nurse/package

router.get('/nurse-services', protect('nurse'), getAllMasterServicesForSelection); // For dropdown in package creation form
router.post('/manage', protect('nurse'),nursePackageUploads, managePackage);
router.get('/my-packages', protect('nurse'), getMyPackages);

module.exports = router;