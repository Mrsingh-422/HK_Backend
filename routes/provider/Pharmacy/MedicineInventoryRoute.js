// routes/provider/Pharmacy/MedicineInventoryRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const {searchMasterMedicines,getMasterMedicineById, addToInventory, getMyInventory, updateInventoryItem } = require('../../../controllers/provider/Pharmacy/MedicineInventory');

// base URL: /provider/pharmacy/inventory

router.get('/getMaster', protect('pharmacy'), searchMasterMedicines);
router.get('/getMaster/details/:id', protect('pharmacy'), getMasterMedicineById);

router.post('/add', protect('pharmacy'), addToInventory);
router.get('/my-list', protect('pharmacy'), getMyInventory);
router.put('/update/:id', protect('pharmacy'), updateInventoryItem);

module.exports = router;