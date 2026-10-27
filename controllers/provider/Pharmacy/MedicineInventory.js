// controllers/provider/Pharmacy/MedicineInventory.js

const Medicine = require('../../../models/Medicine');
const MedicineInventory = require('../../../models/MedicineInventory');
const MasterRequest = require('../../../models/MasterRequest');
const mongoose = require('mongoose')
const HsnMaster = require('../../../models/HsnMaster');
const HsnRequest = require('../../../models/HsnRequest');

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
        const { 
            medicineId, mrp, vendor_price, stock_quantity, expiry_date, 
            batch_number, manufacturing_date, hsn_number, packaging,
            isReturnAllowed, isReplacementAllowed // 👈 Toggles received from Vendor form
        } = req.body;
        const pharmacyId = req.user.id;

        if (!batch_number || batch_number.trim() === "") {
            return res.status(400).json({ success: false, message: "Batch number is required." });
        }

        let validatedHsn = "";
        if (hsn_number && hsn_number.trim() !== "") {
            const hsnExists = await HsnMaster.findOne({ hsnCode: hsn_number.trim(), isActive: true });
            if (!hsnExists) {
                return res.status(400).json({ 
                    success: false, 
                    message: "Compliance Blocked: Selected HSN Code is not active or defined by the Admin." 
                });
            }
            validatedHsn = hsnExists.hsnCode;
        }

        const masterMed = await Medicine.findById(medicineId);
        if (!masterMed) {
            return res.status(404).json({ success: false, message: "Medicine not found in master catalog." });
        }

        const approvedMasterMrp = Number(masterMed.mrp || 0);
        if (approvedMasterMrp > 0 && Number(mrp) > approvedMasterMrp) {
            return res.status(400).json({
                success: false,
                message: `MRP exceeds approved catalog limit of ₹${approvedMasterMrp}.`
            });
        }

        const qty = Number(stock_quantity || 0);
        const finalPackaging = packaging && packaging.trim() !== "" ? packaging.trim() : (masterMed.packaging || "10 tablets");

        const inventoryItem = await MedicineInventory.findOneAndUpdate(
            { pharmacyId, medicineId, batch_number: batch_number.trim() },
            { 
                mrp: Number(mrp),
                vendor_price, 
                stock_quantity: qty, 
                expiry_date, 
                packaging: finalPackaging, 
                manufacturing_date: manufacturing_date ? new Date(manufacturing_date) : undefined, 
                hsn_number: validatedHsn,
                // 🚨 Saved Vendor Return & Replace Permissions per Item
                isReturnAllowed: isReturnAllowed === true || isReturnAllowed === 'true',
                isReplacementAllowed: isReplacementAllowed === true || isReplacementAllowed === 'true',
                is_available: qty > 0 
            },
            { upsert: true, new: true }
        );

        res.status(201).json({ success: true, message: "Medicine batch added with return/replace settings!", data: inventoryItem });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Update Medicine Inventory Item (Price, Stock, Expiry, Batch, HSN, Return & Replace Toggles)
// @route   PUT /provider/pharmacy/inventory/update/:id
// @access  Private (Pharmacy)
const updateInventoryItem = async (req, res) => {
    try {
        const { id } = req.params;
        const pharmacyId = req.user.id;
        const { 
            vendor_price, 
            stock_quantity, 
            manufacturing_date, 
            hsn_number, 
            batch_number, 
            expiry_date, 
            mrp 
        } = req.body;

        if (!id || !mongoose.isValidObjectId(id)) {
            return res.status(400).json({ 
                success: false, 
                message: "A valid 24-character hexadecimal MongoDB ID is required." 
            });
        }

        // 1. Dual Lookup: Search by inventory _id OR medicineId to prevent 404 on frontend ID mismatch
        const query = {
            pharmacyId,
            $or: [
                { _id: new mongoose.Types.ObjectId(id) },
                { medicineId: new mongoose.Types.ObjectId(id) }
            ]
        };

        const existingItem = await MedicineInventory.findOne(query);
        if (!existingItem) {
            return res.status(404).json({ 
                success: false, 
                message: "Medicine item not found in your inventory or unauthorized access." 
            });
        }

        // 2. Safe Boolean Parser Helper (Handles true/false, "true"/"false", 1/0, "1"/"0", "on"/"off")
        const parseBooleanSafe = (val) => {
            if (val === undefined || val === null) return undefined;
            if (typeof val === 'boolean') return val;
            if (typeof val === 'number') return val === 1;
            if (typeof val === 'string') {
                const clean = val.trim().toLowerCase();
                if (['true', '1', 'yes', 'on'].includes(clean)) return true;
                if (['false', '0', 'no', 'off', ''].includes(clean)) return false;
            }
            return Boolean(val);
        };

        const updateData = {};

        // 3. Update Pricing, Stock, Batch and Dates
        if (mrp !== undefined && !isNaN(Number(mrp))) {
            updateData.mrp = Number(mrp);
        }

        if (vendor_price !== undefined && !isNaN(Number(vendor_price))) {
            updateData.vendor_price = Number(vendor_price);
        }

        if (stock_quantity !== undefined && !isNaN(Number(stock_quantity))) {
            const qty = Math.max(0, Number(stock_quantity));
            updateData.stock_quantity = qty;
            updateData.is_available = qty > 0; 
        }

        if (manufacturing_date !== undefined) {
            updateData.manufacturing_date = manufacturing_date ? new Date(manufacturing_date) : null;
        }

        if (expiry_date !== undefined) {
            updateData.expiry_date = expiry_date ? new Date(expiry_date) : null;
        }

        if (batch_number !== undefined && String(batch_number).trim() !== "") {
            updateData.batch_number = String(batch_number).trim();
        }

        if (hsn_number !== undefined) {
            updateData.hsn_number = hsn_number ? String(hsn_number).trim() : null;
        }

        // 4. Multi-Key Fallback & Robust Boolean Parsing for Return Toggle
        const rawReturn = req.body.isReturnAllowed !== undefined 
            ? req.body.isReturnAllowed 
            : (req.body.isReturnable !== undefined 
                ? req.body.isReturnable 
                : (req.body.returnAllowed !== undefined 
                    ? req.body.returnAllowed 
                    : (req.body.isReturn !== undefined 
                        ? req.body.isReturn 
                        : req.body.return_allowed)));

        const parsedReturn = parseBooleanSafe(rawReturn);
        if (parsedReturn !== undefined) {
            updateData.isReturnAllowed = parsedReturn;
        }

        // 5. Multi-Key Fallback & Robust Boolean Parsing for Replacement Toggle
        const rawReplacement = req.body.isReplacementAllowed !== undefined 
            ? req.body.isReplacementAllowed 
            : (req.body.isReplaceable !== undefined 
                ? req.body.isReplaceable 
                : (req.body.replacementAllowed !== undefined 
                    ? req.body.replacementAllowed 
                    : (req.body.isReplacement !== undefined 
                        ? req.body.isReplacement 
                        : req.body.replacement_allowed)));

        const parsedReplacement = parseBooleanSafe(rawReplacement);
        if (parsedReplacement !== undefined) {
            updateData.isReplacementAllowed = parsedReplacement;
        }

        // 6. Execute atomic update and populate medicineId for frontend state consistency
        const updated = await MedicineInventory.findOneAndUpdate(
            { _id: existingItem._id, pharmacyId },
            { $set: updateData },
            { new: true, runValidators: true }
        ).populate('medicineId', 'name manufacturers packaging image_url salt_composition mrp');

        res.status(200).json({ 
            success: true, 
            message: "Medicine inventory and return/replacement settings updated successfully.", 
            data: updated 
        });

    } catch (error) {
        console.error("Update Inventory Item Error:", error);
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
                    manufacturing_date: 1,
                    hsn_number: 1,
                    // 🚨 FIXED: Injected Vendor Return & Replace Permissions
                    isReturnAllowed: { $ifNull: ["$isReturnAllowed", false] },
                    isReplacementAllowed: { $ifNull: ["$isReplacementAllowed", false] },
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

const deleteInventoryItem = async (req, res) => {
    try {
        const pharmacyId = req.user.id;
        
        const deleted = await MedicineInventory.findOneAndDelete({
            _id: req.params.id,
            pharmacyId
        });

        if (!deleted) {
            return res.status(404).json({ success: false, message: "Medicine not found in your inventory or unauthorized" });
        }

        // 🚨 CLEANUP: Also remove or deactivate active combo offers for this medicine
        const PharmacyComboOffer = require('../../../models/PharmacyComboOffer');
        await PharmacyComboOffer.deleteMany({
            pharmacyId,
            medicineId: deleted.medicineId
        });

        res.status(200).json({ 
            success: true, 
            message: "Medicine and associated promo campaigns removed successfully!" 
        });
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



////////////////////////////////////
// 3. Vendor: Request Admin to add a new HSN code to the master list
////////////////////////////////////

// 1. Vendor: Admin ko Naya HSN add karne ki request bhejna
// Endpoint: POST /provider/pharmacy/hsn-request/create
const requestNewHsnCode = async (req, res) => {
    try {
        const { hsnCode, description, suggestedTaxPercent, reason } = req.body;
        const vendorId = req.user.id;

        if (!hsnCode || !description || suggestedTaxPercent === undefined) {
            return res.status(400).json({ success: false, message: "HSN Code, description, and tax rate are required." });
        }

        const cleanCode = hsnCode.trim();

        // Check karein agar HSN pehle se active list me hai
        const alreadyExists = await HsnMaster.findOne({ hsnCode: cleanCode, isActive: true });
        if (alreadyExists) {
            return res.status(400).json({ 
                success: false, 
                message: `HSN Code '${cleanCode}' already exists in the master list with ${alreadyExists.totalGstPercent}% GST.` 
            });
        }

        // Pending Request create karein
        const newRequest = await HsnRequest.create({
            vendorId,
            hsnCode: cleanCode,
            description: description.trim(),
            suggestedTaxPercent: Number(suggestedTaxPercent),
            reason: reason || "New medicine/device batch arrived."
        });

        res.status(201).json({
            success: true,
            message: "Request submitted to Admin successfully! You can track its status in your dashboard.",
            data: newRequest
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. Vendor: Apni bheji hui HSN requests aur Rejection Reasons dekhna
// Endpoint: GET /provider/pharmacy/hsn-request/my-requests
const getMyHsnRequests = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const requests = await HsnRequest.find({ vendorId }).sort({ createdAt: -1 });

        res.json({
            success: true,
            count: requests.length,
            data: requests
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
    requestMrpIncrease,
    requestNewHsnCode,
    getMyHsnRequests
};