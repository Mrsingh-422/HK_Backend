// controllers/provider/Pharmacy/MedicineInventory.js

const Medicine = require('../../../models/Medicine');
const MedicineInventory = require('../../../models/MedicineInventory');
const MasterRequest = require('../../../models/MasterRequest');
const mongoose = require('mongoose')

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

// 🌟 4. NEW API: GET MY NON-PRESCRIPTION INVENTORY (OTC Only)
const getMyNonPrescriptionInventory = async (req, res) => {
    try {
        const pharmacyId = req.user.id;

        // Using aggregate to strictly filter on database layer for performance [3]
        const list = await MedicineInventory.aggregate([
            {
                $match: {
                    pharmacyId: new mongoose.Types.ObjectId(pharmacyId)
                }
            },
            {
                $lookup: {
                    from: "medicines", // Target medicines collection [3]
                    localField: "medicineId",
                    foreignField: "_id",
                    as: "medicineDetails"
                }
            },
            {
                $unwind: "$medicineDetails"
            },
            {
                // Strict regex filter matching "No" or "no" or "false" [3]
                $match: {
                    "medicineDetails.prescription_required": { $regex: /^(no|false)$/i }
                }
            },
            {
                // Re-structuring keys to mirror populate structure for frontend compatibility [3]
                $project: {
                    _id: 1,
                    pharmacyId: 1,
                    vendor_price: 1,
                    stock_quantity: 1,
                    expiry_date: 1,
                    is_available: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    medicineId: {
                        _id: "$medicineDetails._id",
                        name: "$medicineDetails.name",
                        manufacturers: "$medicineDetails.manufacturers",
                        image_url: "$medicineDetails.image_url",
                        salt_composition: "$medicineDetails.salt_composition",
                        mrp: "$medicineDetails.mrp",
                        prescription_required: "$medicineDetails.prescription_required"
                    }
                }
            },
            {
                $sort: { updatedAt: -1 }
            }
        ]);

        res.status(200).json({ success: true, count: list.length, data: list });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateInventoryItem = async (req, res) => {
    try {
        const { vendor_price, stock_quantity } = req.body;
        const pharmacyId = req.user.id; // Logged-in pharmacy id for security

        const updateData = {};
        
        if (vendor_price !== undefined) {
            updateData.vendor_price = Number(vendor_price);
        }
        
        if (stock_quantity !== undefined) {
            const qty = Number(stock_quantity);
            updateData.stock_quantity = qty;
            
            // 🚨 STRICT CHECK: Automatically sets true if > 0, false if <= 0
            updateData.is_available = qty > 0; 
        }

        // Secure update: Pharmacy can only update its own inventory records
        const updated = await MedicineInventory.findOneAndUpdate(
            { _id: req.params.id, pharmacyId },
            updateData,
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ 
                success: false, 
                message: "Medicine not found in your inventory or unauthorized" 
            });
        }

        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteInventoryItem = async (req, res) => {
    try {
        const pharmacyId = req.user.id; // Logged-in pharmacy id
        
        // Taaki pharmacy sirf apne hi inventory item ko delete kar sake
        const deleted = await MedicineInventory.findOneAndDelete({
            _id: req.params.id,
            pharmacyId
        });

        if (!deleted) {
            return res.status(404).json({ success: false, message: "Medicine not found in your inventory or unauthorized" });
        }

        res.status(200).json({ success: true, message: "Medicine removed from your inventory successfully!" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// Request to add a new medicine to Master Database
// Endpoint: POST /provider/pharmacy/inventory/request-add
const requestNewMedicineAdd = async (req, res) => {
    try {
        const pharmacyId = req.user.id;
        const { name, manufacturers, salt_composition, packaging, mrp, best_price, description, prescription_required, image_url } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, message: "Medicine name is required" });
        }

        // Medicine डेटा तैयार करें
        const medicineData = {
            name,
            manufacturers,
            salt_composition,
            packaging,
            mrp,
            best_price,
            description,
            prescription_required: prescription_required || "No",
            image_url: Array.isArray(image_url) ? image_url : (image_url ? [image_url] : [])
        };

        // Master Request क्रिएट करें
        const newRequest = await MasterRequest.create({
            vendorId: pharmacyId,
            vendorType: 'Pharmacy',
            requestType: 'Medicine',
            data: medicineData
        });

        res.status(201).json({ 
            success: true, 
            message: "Request to add new medicine submitted successfully!", 
            data: newRequest 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = { 
    searchMasterMedicines, 
    getMasterMedicineById, 
    addToInventory, 
    getMyInventory, 
    getMyNonPrescriptionInventory,
    updateInventoryItem ,
    deleteInventoryItem,
    requestNewMedicineAdd
};