const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const { 
    addInsuranceType, 
    getInsuranceTypes, 
    addInsurance, 
    getInsuranceList, 
    updateInsuranceStatus 
} = require('../../../controllers/admin/user/insuranceAdd');

// Base URL: /admin/user/insurance

// --- Master Types (Enum Alternative) ---
router.post('/add-type', protect('admin'), addInsuranceType);
router.get('/insurance-types', getInsuranceTypes); // Frontend dropdown ke liye

// --- Main Insurance ---
router.post('/add-insurance', protect('admin'), addInsurance);
router.get('/insurance-list', getInsuranceList);
router.patch('/update-status/:id', protect('admin'), updateInsuranceStatus);

module.exports = router;