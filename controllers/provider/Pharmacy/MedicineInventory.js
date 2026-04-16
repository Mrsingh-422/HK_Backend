// controllers/provider/Pharmacy/MedicineInventory.js

const Medicine = require('../../../models/Medicine');
const MedicineInventory = require('../../../models/MedicineInventory');

// 1. Master Medicine Database mein se search karna (Inventory mein add karne ke liye)
// Endpoint: GET /provider/pharmacy/inventory/getMaster?query=dolo&page=1
const searchMasterMedicines = async (req, res) => {
    try {
        const { query, page = 1, limit = 20 } = req.query;
        const skip = (page - 1) * limit;

        let filter = {};
        if (query) {
            const regex = new RegExp(query, 'i');
            filter = {
                $or: [
                    { name: regex },
                    { salt_composition: regex },
                    { manufacturers: regex }
                ]
            };
        }

        const medicines = await Medicine.find(filter)
            .select('name manufacturers salt_composition packaging mrp image_url')
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ name: 1 });

        const total = await Medicine.countDocuments(filter);

        res.json({
            success: true,
            total,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            data: medicines
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. Kisi ek specific medicine ki detail dekhna (Master List se)
// Endpoint: GET /provider/pharmacy/inventory/getMaster/details/:id
const getMasterMedicineById = async (req, res) => {
    try {
        const medicine = await Medicine.findById(req.params.id);
        if (!medicine) {
            return res.status(404).json({ success: false, message: "Medicine not found in master list" });
        }
        res.json({ success: true, data: medicine });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- AAPKE PURANE FUNCTIONS ---

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

module.exports = { 
    searchMasterMedicines, 
    getMasterMedicineById, 
    addToInventory, 
    getMyInventory, 
    updateInventoryItem 
};