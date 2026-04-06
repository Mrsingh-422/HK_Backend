const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    addMasterCondition, 
    addMasterAllergy, 
    getConditions, 
    getAllergies, 
    getMajorConditions  
} = require('../../../controllers/admin/others/MedicalMaster');

// Base URL: /admin/medical-masters

router.post('/add-condition', protect('admin'), addMasterCondition);
router.post('/add-allergy', protect('admin'), addMasterAllergy);

router.get('/conditions', getConditions);
router.get('/allergies', getAllergies);
router.get('/major-conditions', getMajorConditions);

module.exports = router;