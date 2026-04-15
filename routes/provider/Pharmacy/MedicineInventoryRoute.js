// routes/provider/Pharmacy/MedicineInventoryRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { addToInventory, getMyInventory, updateInventoryItem } = require('../../../controllers/provider/Pharmacy/MedicineInventory');

// base URL: /provider/pharmacy/inventory

router.post('/add', protect('pharmacy'), addToInventory);
router.get('/my-list', protect('pharmacy'), getMyInventory);
router.put('/update/:id', protect('pharmacy'), updateInventoryItem);

module.exports = router;