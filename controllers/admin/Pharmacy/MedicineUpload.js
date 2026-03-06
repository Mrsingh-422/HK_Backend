const Medicine = require('../../../models/Medicine');
const xlsx = require('xlsx');
const fs = require('fs');

// --- 1. UPLOAD EXCEL AND SAVE MEDICINES ---
const uploadMedicinesExcel = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "Please upload an Excel file" });
        }

        // 1. Read Excel File
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0]; // Pehli sheet select karein
        const sheet = workbook.Sheets[sheetName];

        // 2. Convert Excel to JSON
        let jsonData = xlsx.utils.sheet_to_json(sheet);

        if (jsonData.length === 0) {
            return res.status(400).json({ message: "Excel file is empty" });
        }

        // 3. Format Data (Keys ko match karna aur Images ko Array banana)
        const formattedData = jsonData.map(row => {
            return {
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
                
                // Image URLs pipe (|) se separated hain, unhe array banayein
                image_url: row['image_url'] 
                    ? row['image_url'].split('|').map(img => img.trim()) 
                    : [],

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
            };
        });

        // 4. Bulk Insert to Database
        await Medicine.insertMany(formattedData);

        // 5. Delete file from server after processing (Optional but recommended)
        fs.unlinkSync(req.file.path);

        res.status(201).json({ 
            success: true, 
            message: `${formattedData.length} Medicines added successfully!`,
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error processing file: " + error.message });
    }
};

// --- 2. GET ALL MEDICINES LIST ---
const getMedicinesList = async (req, res) => {
    try {
        // Pagination logic (Agar 10,000 meds hain to ek baar me sab nahi bhej sakte)
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;

        // Search by Name logic
        const searchQuery = req.query.search 
            ? { name: { $regex: req.query.search, $options: 'i' } } 
            : {};

        const medicines = await Medicine.find(searchQuery)
                                        .skip(skip)
                                        .limit(limit);

        const total = await Medicine.countDocuments(searchQuery);

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

// --- 3. CREATE SINGLE MEDICINE MANUALLY ---
const createMedicine = async (req, res) => {
    try {
        const {
            name, mrp, best_price, manufacturers, salt_composition,
            packaging, discont_percent, prescription_required, image_url,
            primary_use, description, storage, side_effect, how_to_use,
            safety_advise, alternate_brand, manufaturer_address
        } = req.body;

        // 1. Validation: Name zaroori hai
        if (!name) {
            return res.status(400).json({ message: "Medicine name is required" });
        }

        // 2. Check Duplicate (Optional: Check if medicine already exists)
        const existingMedicine = await Medicine.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
        if (existingMedicine) {
            return res.status(400).json({ message: "Medicine with this name already exists" });
        }

        // 3. Create Medicine Object
        // Note: image_url agar string bheja hai comma ke sath, to array bana lo
        const images = Array.isArray(image_url) ? image_url : (image_url ? image_url.split(',') : []);

        const newMedicine = await Medicine.create({
            ...req.body,
            image_url: images,
            originalId: "MANUAL-" + Date.now() // Unique ID for manual entries
        });

        res.status(201).json({
            success: true,
            message: "Medicine added manually successfully!",
            data: newMedicine
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};



module.exports = { uploadMedicinesExcel, getMedicinesList, createMedicine };