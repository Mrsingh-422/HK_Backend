const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    addInsuranceType, 
    getInsuranceTypes, 
    addInsurance, 
    getInsuranceList, 
    updateInsuranceStatus,
    updateInsurance,
    deleteInsurance
} = require('../../../controllers/admin/user/insuranceAdd');

// Master Types
router.post('/add-type', protect('admin'), addInsuranceType);
router.get('/insurance-types', getInsuranceTypes);

// Main Insurance APIs
router.post('/add-insurance', protect('admin'), addInsurance);
router.get('/insurance-list', getInsuranceList);
router.patch('/update-status/:id', protect('admin'), updateInsuranceStatus);
router.put('/update/:id', protect('admin'), updateInsurance);
router.delete('/delete/:id', protect('admin'), deleteInsurance);

module.exports = router; 