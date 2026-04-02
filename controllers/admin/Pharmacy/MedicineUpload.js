const Medicine = require('../../../models/Medicine');
const xlsx = require('xlsx');
const fs = require('fs');

// --- 1. UPLOAD EXCEL (Pehle jaisa hi hai) ---
const uploadMedicinesExcel = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Please upload an Excel file" });
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const jsonData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (jsonData.length === 0) return res.status(400).json({ message: "Excel file is empty" });

        const formattedData = jsonData.map(row => ({
            originalId: row['Id'] ? String(row['Id']) : null,
            bread_crumb: row['bread_crumb'],
            url: row['url'],
            name: row['name'],
            manufacturers: row['manufacturers'],
            salt_composition: row['salt_composition'],
            packaging: row['packaging'],
            mrp: row['mrp'] ? String(row['mrp']) : null,
            best_price: row['best_price'] ? String(row['best_price']) : null,
            discont_percent: row['discont_percent'],
            prescription_required: row['prescription_required'],
            image_url: row['image_url'] ? row['image_url'].split('|').map(img => img.trim()) : [],
            primary_use: row['primary_use'],
            description: row['description'],
            salt_synonmys: row['salt_synonmys'],
            storage: row['storage'],
            introduction: row['introduction'],
            use_of: row['use_of'],
            benefits: row['benefits'],
            side_effect: row['side_effect'],
            how_to_use: row['how_to_use'],
            how_works: row['how_works'],
            safety_advise: row['safety_advise'],
            if_miss: row['if_miss'],
            alternate_brand: row['alternate_brand'],
            manufaturer_address: row['manufaturer_address'],
            for_sale: row['for_sale']
        }));

        await Medicine.insertMany(formattedData);
        fs.unlinkSync(req.file.path);
        res.status(201).json({ success: true, message: `${formattedData.length} Medicines added!` });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 2. GET ALL MEDICINES LIST (GET Method - Pagination 20 per page) ---
const getMedicinesList = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20; // Fixed 20 per page as requested
        const skip = (page - 1) * limit;

        const medicines = await Medicine.find()
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Medicine.countDocuments();

        res.json({
            success: true,
            totalMedicines: total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            data: medicines
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 3. SEARCH MEDICINES (POST Method) ---
// Body: { "search": "paracetamol", "page": 1 }
const searchMedicines = async (req, res) => {
    try {
        const { search, page = 1 } = req.body;
        const limit = 20;
        const skip = (page - 1) * limit;

        if (!search) {
            return res.status(400).json({ message: "Search term is required" });
        }

        // Search logic for multiple fields
        const query = {
            $or: [
                { name: { $regex: search, $options: 'i' } },
                { salt_composition: { $regex: search, $options: 'i' } },
                { manufacturers: { $regex: search, $options: 'i' } },
                { primary_use: { $regex: search, $options: 'i' } }
            ]
        };

        const medicines = await Medicine.find(query)
            .skip(skip)
            .limit(limit);

        const total = await Medicine.countDocuments(query);

        res.json({
            success: true,
            totalResults: total,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            data: medicines
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 4. CREATE SINGLE MEDICINE ---
const createMedicine = async (req, res) => {
    try {
        const { name, image_url } = req.body;
        if (!name) return res.status(400).json({ message: "Medicine name is required" });

        const images = Array.isArray(image_url) ? image_url : (image_url ? image_url.split(',') : []);

        const newMedicine = await Medicine.create({
            ...req.body,
            image_url: images,
            originalId: "MANUAL-" + Date.now()
        });

        res.status(201).json({ success: true, data: newMedicine });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 5. UPDATE MEDICINE ---
const updateMedicine = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        if (updateData.image_url && typeof updateData.image_url === 'string') {
            updateData.image_url = updateData.image_url.split(',').map(img => img.trim());
        }

        const updatedMedicine = await Medicine.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!updatedMedicine) return res.status(404).json({ message: "Medicine not found" });
        res.json({ success: true, data: updatedMedicine });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 6. DELETE MEDICINE ---
const deleteMedicine = async (req, res) => {
    try {
        const deleted = await Medicine.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ message: "Medicine not found" });
        res.json({ success: true, message: "Deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 7. DETAILS ---
const getMedicineDetails = async (req, res) => {
    try {
        const medicine = await Medicine.findById(req.params.id);
        if (!medicine) return res.status(404).json({ message: "Medicine not found" });
        res.json({ success: true, data: medicine });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    uploadMedicinesExcel, getMedicinesList, searchMedicines, 
    createMedicine, updateMedicine, deleteMedicine, getMedicineDetails 
};