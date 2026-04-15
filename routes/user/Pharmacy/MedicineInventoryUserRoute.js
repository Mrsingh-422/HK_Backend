const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { getMedicineInventory,  searchMedicinesUser,
    getMedicineFullDetails,
    getSellersForMedicine } = require('../../../controllers/user/Pharmacy/MedicineInventoryUser');

// Base URL: /user/medicine

router.get('/offers/:medicineId', protect('user'), getMedicineInventory);
// Search and Category List
router.post('/search', searchMedicinesUser);

// Full Detail Page (Description, Safety, Side Effects)
router.get('/details/:medicineId', getMedicineFullDetails);

// Compare Prices (List of all pharmacies selling this)
router.get('/sellers/:medicineId', getSellersForMedicine);


module.exports = router;