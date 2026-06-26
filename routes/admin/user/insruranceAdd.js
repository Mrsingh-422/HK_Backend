const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    addInsuranceType, 
    getInsuranceTypes, 
    addInsurance, 
    getInsuranceList, 
    updateInsuranceStatus,
    updateInsurance,
    deleteInsurance
} = require('../../../controllers/admin/user/insuranceAdd');

// Base URL: /admin/user/insurance

// Master Types
router.post('/add-type', protect('admin'), checkRoleAccess(21),addInsuranceType);
router.get('/insurance-types', getInsuranceTypes);

// Main Insurance APIs
router.post('/add-insurance', protect('admin'),checkRoleAccess(21), addInsurance);
router.get('/insurance-list', getInsuranceList);
router.patch('/update-status/:id', protect('admin'),checkRoleAccess(21),  updateInsuranceStatus);
router.put('/update/:id', protect('admin'), checkRoleAccess(21), updateInsurance);
router.delete('/delete/:id', protect('admin'), checkRoleAccess(21), deleteInsurance);

module.exports = router; 