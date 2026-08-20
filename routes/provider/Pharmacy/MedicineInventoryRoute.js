// routes/provider/Pharmacy/MedicineInventoryRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const {searchMasterMedicines,getMasterMedicineById, addToInventory, getMyInventory,getMyNonPrescriptionInventory, updateInventoryItem ,deleteInventoryItem,
    requestNewMedicineAdd,requestMrpIncrease,
    requestNewHsnCode,getMyHsnRequests
} = require('../../../controllers/provider/Pharmacy/MedicineInventory');

// base URL: /provider/pharmacy/inventory

router.get('/getMaster', protect('pharmacy'), searchMasterMedicines);
router.get('/getMaster/details/:id', protect('pharmacy'), getMasterMedicineById);

router.post('/add', protect('pharmacy'), addToInventory);
router.get('/my-list', protect('pharmacy'), getMyInventory);
router.get('/my-otc-list', protect('pharmacy'), getMyNonPrescriptionInventory);
router.put('/update/:id', protect('pharmacy'), updateInventoryItem);
router.delete('/delete/:id', protect('pharmacy'), deleteInventoryItem);

// requests mrp increase
router.post('/request-add', protect('pharmacy'), requestNewMedicineAdd); 
router.post('/request-mrp-increase', protect('pharmacy'), requestMrpIncrease);

// HSN Code Requests
router.post('/hsn-request/create', protect('pharmacy'), requestNewHsnCode);
router.get('/hsn-request/my-requests', protect('pharmacy'), getMyHsnRequests);

module.exports = router;