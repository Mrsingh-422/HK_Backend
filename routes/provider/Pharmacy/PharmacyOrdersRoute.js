const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getPharmacyOrders, 
    getAvailableDrivers, 
    assignDriverManual , reassignDriverManual
} = require('../../../controllers/provider/Pharmacy/PharmacyOrders');

// Base: /provider/pharmacy/orders

router.get('/list', protect('pharmacy'), getPharmacyOrders);
router.get('/available-drivers', protect('pharmacy'), getAvailableDrivers);
router.post('/assign-manual', protect('pharmacy'), assignDriverManual);
router.post('/reassign', protect('pharmacy'), reassignDriverManual);

module.exports = router;