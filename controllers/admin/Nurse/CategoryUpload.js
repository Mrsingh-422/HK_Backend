const xlsx = require('xlsx');
const fs = require('fs');
const CareService = require('../../../models/CareService');
const MasterConsumable = require('../../../models/MasterConsumable');

// 1. UPLOAD CARE SERVICES (Template)
const uploadCareCSV = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Please upload a file" });

        const workbook = xlsx.readFile(req.file.path);
        const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });

        const results = [];
        let lastCategory = "";     

        sheetData.forEach((row) => {
            if (row['Care Category'] && String(row['Care Category']).trim() !== "") {
                lastCategory = String(row['Care Category']).trim();
            }

            const currentSubCat = row['Care_Sub-category'] ? String(row['Care_Sub-category']).trim() : "";

            if (lastCategory !== "" && currentSubCat !== "") {
                results.push({
                    category: lastCategory,
                    subCategory: currentSubCat,
                    categoryUrl: row['category_url'] || "",
                    description: row['description'] || "",
                    noCare: row['no_Care'] || "",
                    procedureIncluded: row['Procedure included'] || "",
                    prescriptionStatus: String(row['Prescription Status']).toUpperCase() === 'YES' ? 'YES' : 'NO',
                    servicesOffered: row['Services Offered'] || "NURSING CARE",
                    pricePerHour: parseFloat(row['Price per Hour']) || 0,
                    oneDayOneTimePrice: parseFloat(row['One Day One time Price']) || 0,
                    forMultipleDaysPrice: parseFloat(row['For Mutliple Days Price']) || 0, // Updated key
                    careList: row['Care_list'] ? String(row['Care_list']).split('||').map(i => i.trim()) : [],
                    consumablesUsed: row['Consumables Used'] || ""
                });
            }
        });

        await CareService.deleteMany({}); 
        await CareService.insertMany(results);
        fs.unlinkSync(req.file.path);

        res.json({ success: true, message: `${results.length} Services uploaded successfully!` });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. UPLOAD MASTER CONSUMABLES (The 100+ items list)
const uploadMasterConsumables = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Please upload a file" });

        // Encoding handle karne ke liye readFile options
        const workbook = xlsx.readFile(req.file.path, { codepage: 65001 }); // UTF-8 support
        const sheetName = workbook.SheetNames[0];
        const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        const results = [];

        sheetData.forEach((row) => {
            let itemName = "";
            let size = "";
            let category = "";
            let unitType = "";
            let mrpRaw = 0;

            // DYNAMIC KEY MATCHING: Column ka naam kuch bhi ho, ye dhoond lega
            Object.keys(row).forEach(key => {
                const k = key.toLowerCase().trim();
                
                if (k.includes('item') && k.includes('name')) itemName = row[key];
                else if (k.includes('item') && !k.includes('name')) itemName = itemName || row[key]; // Fallback for 'Item'
                
                if (k.includes('size') || k.includes('specification')) size = row[key];
                
                if (k.includes('category')) category = row[key];
                
                if (k.includes('unit')) unitType = row[key];
                
                // MRP dhoondne ka logic (Agar key mein 'mrp' ya 'price' ho)
                if (k.includes('mrp') || k.includes('price')) {
                    mrpRaw = row[key];
                }
            });

            // MRP cleaning logic
            let cleanMRP = 0;
            if (mrpRaw !== undefined && mrpRaw !== null) {
                cleanMRP = typeof mrpRaw === 'string' 
                    ? parseFloat(mrpRaw.replace(/[^0-9.]/g, '')) 
                    : parseFloat(mrpRaw);
            }

            if (itemName && String(itemName).trim() !== "") {
                results.push({
                    itemName: String(itemName).trim(),
                    size: size ? String(size).trim() : "Standard",
                    category: category ? String(category).trim() : "General",
                    unitType: unitType ? String(unitType).trim() : "Piece",
                    mrp: cleanMRP || 0,
                    isActive: true
                });
            }
        });

        if (results.length > 0) {
            await MasterConsumable.deleteMany({});
            await MasterConsumable.insertMany(results);
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

            res.json({ 
                success: true, 
                count: results.length,
                message: `${results.length} items uploaded. MRP issue fixed!` 
            });
        } else {
            res.status(400).json({ success: false, message: "No valid data found" });
        }

    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({ message: error.message });
    }
};

// Linked APIs for Flutter
const getCareCategories = async (req, res) => {
    const categories = await CareService.distinct('category');
    res.json({ success: true, data: categories });
};

const getCareSubCategories = async (req, res) => {
    const subCategories = await CareService.find({ category: req.query.category }).distinct('subCategory');
    res.json({ success: true, data: subCategories });
};

const getCareDetails = async (req, res) => {
    const details = await CareService.findOne({ category: req.query.category, subCategory: req.query.subCategory });
    res.json({ success: true, data: details });
};

module.exports = { uploadCareCSV, uploadMasterConsumables, getCareCategories, getCareSubCategories, getCareDetails };