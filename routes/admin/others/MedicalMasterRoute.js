const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    addMasterCondition, 
    addMasterAllergy, 
    getConditions, 
    getAllergies, 
    getMajorConditions  
} = require('../../../controllers/admin/others/MedicalMaster');

// Base URL: /admin/medical-masters

router.post('/add-condition', protect('admin'), checkRoleAccess(24),addMasterCondition);
router.post('/add-allergy', protect('admin'), checkRoleAccess(24),addMasterAllergy);

router.get('/conditions', getConditions);
router.get('/allergies', getAllergies);
router.get('/major-conditions', getMajorConditions);

module.exports = router;