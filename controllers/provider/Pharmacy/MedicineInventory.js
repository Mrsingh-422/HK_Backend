// controllers/provider/Pharmacy/MedicineInventory.js
const Medicine = require('../../../models/Medicine');
const MedicineInventory = require('../../../models/MedicineInventory');

// 1. Pharmacy Master List se search karke Add karegi
// Endpoint: POST /provider/pharmacy/inventory/add
const addToInventory = async (req, res) => {
    try {
        const { medicineId, vendor_price, stock_quantity, expiry_date } = req.body;
        const pharmacyId = req.user.id;

        const inventoryItem = await MedicineInventory.findOneAndUpdate(
            { pharmacyId, medicineId },
            { 
                vendor_price, 
                stock_quantity, 
                expiry_date, 
                is_available: stock_quantity > 0 
            },
            { upsert: true, new: true }
        );

        res.status(201).json({ success: true, message: "Medicine added to your store!", data: inventoryItem });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. Pharmacy apni khud ki listed medicines dekhegi
// Endpoint: GET /provider/pharmacy/inventory/my-list
const getMyInventory = async (req, res) => {
    try {
        const pharmacyId = req.user.id;
        const list = await MedicineInventory.find({ pharmacyId })
            .populate('medicineId', 'name manufacturers image_url salt_composition mrp')
            .sort({ updatedAt: -1 });

        res.status(200).json({ success: true, data: list });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. Price ya Stock update karne ke liye
// Endpoint: PUT /provider/pharmacy/inventory/update/:id
const updateInventoryItem = async (req, res) => {
    try {
        const { vendor_price, stock_quantity } = req.body;
        const updated = await MedicineInventory.findByIdAndUpdate(
            req.params.id,
            { vendor_price, stock_quantity },
            { new: true }
        );
        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { addToInventory, getMyInventory, updateInventoryItem };