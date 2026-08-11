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
        const { medicineId, mrp, vendor_price, stock_quantity, expiry_date, batch_number, manufacturing_date, hsn_number, packaging } = req.body;
        const pharmacyId = req.user.id;

        if (!batch_number || batch_number.trim() === "") {
            return res.status(400).json({ success: false, message: "Batch number is required to register medicine inventory." });
        }

        // 🚨 STRICT COMPLIANCE CHECK: HSN is now mandatory
        if (!hsn_number || hsn_number.trim() === "") {
            return res.status(400).json({ success: false, message: "HSN classification code is strictly compulsory to add inventory." });
        }

        if (!mrp || Number(mrp) <= 0) {
            return res.status(400).json({ success: false, message: "A valid batch-specific MRP is required." });
        }

        const masterMed = await Medicine.findById(medicineId);
        if (!masterMed) {
            return res.status(404).json({ success: false, message: "Medicine not found in master database list." });
        }

        const approvedMasterMrp = Number(masterMed.mrp || 0);

        if (approvedMasterMrp > 0 && Number(mrp) > approvedMasterMrp) {
            return res.status(400).json({
                success: false,
                message: `Compliance Blocked: The entered batch MRP (₹${mrp}) exceeds the approved master catalog MRP limit of ₹${approvedMasterMrp}. If the brand has officially increased the printed price, please submit an 'MRP Increase Request' to the Admin for approval.`
            });
        }

        const qty = Number(stock_quantity || 0);
        const finalPackaging = packaging && packaging.trim() !== "" ? packaging.trim() : (masterMed.packaging || "10 tablets");

        // Find and update item uniquely matching pharmacy, medicine and specific batch
        const inventoryItem = await MedicineInventory.findOneAndUpdate(
            { pharmacyId, medicineId, batch_number: batch_number.trim() },
            { 
                mrp: Number(mrp),
                vendor_price, 
                stock_quantity: qty, 
                expiry_date, 
                packaging: finalPackaging, 
                manufacturing_date: manufacturing_date ? new Date(manufacturing_date) : undefined, 
                hsn_number: hsn_number.trim(), // 👈 Saved as compulsory string [1]
                is_available: qty > 0 
            },
            { upsert: true, new: true }
        );

        res.status(201).json({ success: true, message: "Medicine batch added to your store!", data: inventoryItem });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getMyInventory = async (req, res) => {
    try {
        const pharmacyId = req.user.id;
        const list = await MedicineInventory.find({ pharmacyId })
            .populate('medicineId', 'name manufacturers image_url salt_composition mrp')
            .sort({ updatedAt: -1 });

        // Formatting response to keep old structures intact while adding master reference MRP [cite: 1.1.2]
        const formattedList = list.map(item => {
            const obj = item.toObject();
            
            if (obj.medicineId && obj.mrp !== undefined) {
                // 1. Capture the original Admin-defined master MRP before overwriting [cite: 1.1.2]
                const originalMasterMrp = obj.medicineId.mrp ? obj.medicineId.mrp.toString() : "0";
                
                // 2. Keep the populated 'mrp' synced with batch MRP for old frontend compatibility [cite: 1.1.2]
                obj.medicineId.mrp = obj.mrp.toString(); 
                
                // 🚨 NEW KEY: Append the original Admin master catalog MRP inside the populated object [cite: 1.1.2]
                obj.medicineId.masterMrp = originalMasterMrp; 
            }
            return obj;
        });

        res.status(200).json({ success: true, data: formattedList });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 🌟 4. NEW API: GET MY NON-PRESCRIPTION INVENTORY (OTC Only)
const getMyNonPrescriptionInventory = async (req, res) => {
    try {
        const pharmacyId = req.user.id;

        const list = await MedicineInventory.aggregate([
            {
                $match: {
                    pharmacyId: new mongoose.Types.ObjectId(pharmacyId)
                }
            },
            {
                $lookup: {
                    from: "medicines", 
                    localField: "medicineId",
                    foreignField: "_id",
                    as: "medicineDetails"
                }
            },
            {
                $unwind: "$medicineDetails"
            },
            {
                $match: {
                    "medicineDetails.prescription_required": { $regex: /^(no|false)$/i }
                }
            },
            {
                $project: {
                    _id: 1,
                    pharmacyId: 1,
                    vendor_price: 1,
                    stock_quantity: 1,
                    expiry_date: 1,
                    is_available: 1,
                    batch_number: 1, 
                    mrp: 1,
                    manufacturing_date: 1, // 🚨 FIXED: Added to aggregate projection [3]
                    hsn_number: 1,         // 🚨 FIXED: Added to aggregate projection [3]
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
        const { vendor_price, stock_quantity, manufacturing_date, hsn_number, batch_number, expiry_date, mrp } = req.body;
        const pharmacyId = req.user.id; // Logged-in pharmacy id for security

        // 1. Fetch existing inventory record first to securely verify medicineId and validate changes
        const existingItem = await MedicineInventory.findOne({ _id: req.params.id, pharmacyId });
        if (!existingItem) {
            return res.status(404).json({ 
                success: false, 
                message: "Medicine not found in your inventory or unauthorized." 
            });
        }

        const updateData = {};
        
        // 🚨 NEW: Safe Batch-level MRP update with dynamic anti-fraud master limit validation [cite: 1.1.2]
        if (mrp !== undefined) {
            const proposedMrp = Number(mrp);
            if (isNaN(proposedMrp) || proposedMrp <= 0) {
                return res.status(400).json({ success: false, message: "A valid batch-specific MRP is required." });
            }

            // Verify if the updated MRP does not exceed the master database approved ceiling [1]
            const masterMed = await Medicine.findById(existingItem.medicineId);
            if (masterMed) {
                const approvedMasterMrp = Number(masterMed.mrp || 0);
                if (approvedMasterMrp > 0 && proposedMrp > approvedMasterMrp) {
                    return res.status(400).json({
                        success: false,
                        message: `Compliance Blocked: The updated batch MRP (₹${proposedMrp}) exceeds the approved master catalog MRP limit of ₹${approvedMasterMrp}. If the printed price has officially increased, please submit an 'MRP Increase Request' to the Admin for approval.`
                    });
                }
            }
            updateData.mrp = proposedMrp;
        }

        if (vendor_price !== undefined) {
            updateData.vendor_price = Number(vendor_price);
        }
        
        if (stock_quantity !== undefined) {
            const qty = Number(stock_quantity);
            updateData.stock_quantity = qty;
            // Automatically sets true if > 0, false if <= 0 [1]
            updateData.is_available = qty > 0; 
        }

        if (manufacturing_date !== undefined) {
            updateData.manufacturing_date = manufacturing_date ? new Date(manufacturing_date) : null;
        }
        if (hsn_number !== undefined) {
            updateData.hsn_number = hsn_number ? hsn_number.trim() : null;
        }

        if (batch_number !== undefined) {
            if (batch_number.trim() === "") {
                return res.status(400).json({ success: false, message: "Batch number cannot be empty." });
            }
            updateData.batch_number = batch_number.trim();
        }
        if (expiry_date !== undefined) {
            updateData.expiry_date = expiry_date ? new Date(expiry_date) : null;
        }

        // Secure update: Pharmacy can only update its own inventory records
        const updated = await MedicineInventory.findOneAndUpdate(
            { _id: req.params.id, pharmacyId },
            updateData,
            { new: true, runValidators: true }
        );

        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        // 🚨 DUPLICATION GUARD: Prevent crash if pharmacist edits to an already existing batch number
        if (error.code === 11000) {
            return res.status(400).json({ 
                success: false, 
                message: "Validation Error: An inventory record with this batch number already exists for this medicine in your store." 
            });
        }
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

// Request Admin to increase master reference MRP of a medicine
// Endpoint: POST /provider/pharmacy/inventory/request-mrp-increase
const requestMrpIncrease = async (req, res) => {
    try {
        const pharmacyId = req.user.id;
        const { medicineId, proposedMrp, reason } = req.body;

        if (!medicineId || !proposedMrp || Number(proposedMrp) <= 0) {
            return res.status(400).json({ success: false, message: "Medicine ID and proposed MRP value are required." });
        }

        const targetMedicine = await Medicine.findById(medicineId);
        if (!targetMedicine) {
            return res.status(404).json({ success: false, message: "Medicine not found in master database." });
        }

        const requestData = {
            medicineId,
            medicineName: targetMedicine.name,
            currentMasterMrp: Number(targetMedicine.mrp || 0),
            proposedMrp: Number(proposedMrp),
            reason: reason || "New batch arrived with higher printed MRP price."
        };

        // Create Master Request Document
        const newRequest = await MasterRequest.create({
            vendorId: pharmacyId,
            vendorType: 'Pharmacy',
            requestType: 'Medicine',
            data: requestData
        });

        res.status(201).json({
            success: true,
            message: "MRP increase request submitted to Admin successfully!",
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
    requestNewMedicineAdd,
    requestMrpIncrease
};