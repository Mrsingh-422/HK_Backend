const csv = require('csv-parser');
const fs = require('fs');
const CareService = require('../../../models/CareService');
const xlsx = require('xlsx');

// 1. UPLOAD & FORWARD FILL LOGIC
const uploadCareCSV = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Please upload a file" });

        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        // raw: false ensures we get empty cells as undefined
        const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });

        if (sheetData.length === 0) {
            return res.status(400).json({ message: "File is empty" });
        }

        const results = [];
        let lastCategory = "";     

        sheetData.forEach((row) => {
            // 1. Category Forward Fill
            const currentCat = row['Care Category'] ? String(row['Care Category']).trim() : "";
            if (currentCat !== "") {
                lastCategory = currentCat;
            }

            // 2. Sub-Category identification
            // Hum record tabhi banayenge jab "Care_Sub-category" wale column mein kuch likha ho
            const currentSubCat = row['Care_Sub-category'] ? String(row['Care_Sub-category']).trim() : "";

            // LOGIC: Agar Category hai aur Sub-Category mil gayi, toh save karo 
            // Chahe baaki fields (price/desc) khali hi kyun na ho
            if (lastCategory !== "" && currentSubCat !== "") {
                results.push({
                    category: lastCategory,
                    subCategory: currentSubCat,
                    categoryUrl: row['category_url'] || "",
                    description: row['description'] || "",
                    procedureIncluded: row['Procedure included'] || "",
                    prescriptionStatus: String(row['Prescription Status']).toUpperCase() === 'YES' ? 'YES' : 'NO',
                    servicesOffered: row['Services Offered'] || "",
                    pricePerHour: parseFloat(row['Price per Hour']) || 0,
                    oneDayOneTimePrice: parseFloat(row['One Day One time Price']) || 0,
                    discountedPrice: parseFloat(row['discounted_price']) || 0,
                    careList: row['Care_list'] ? String(row['Care_list']).split('||').map(i => i.trim()) : [],
                    consumablesUsed: row['Consumables Used'] || ""
                });
            }
        });

        // 3. Database Operations
        if (results.length > 0) {
            await CareService.deleteMany({}); 
            await CareService.insertMany(results);
        }

        fs.unlinkSync(req.file.path);

        res.json({ 
            success: true, 
            message: `Total ${results.length} records uploaded! All categories from 1 to 11 processed.` 
        });

    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({ message: error.message });
    }
};

// 2. GET ALL UNIQUE CATEGORIES (For Dropdown 1)
const getCareCategories = async (req, res) => {
    try {
        const categories = await CareService.distinct('category');
        res.json({ success: true, data: categories });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. GET SUB-CATEGORIES BY CATEGORY (For Dropdown 2)
const getCareSubCategories = async (req, res) => {
    try {
        const { category } = req.query;
        const subCategories = await CareService.find({ category }).distinct('subCategory');
        res.json({ success: true, data: subCategories });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 4. GET FINAL DETAILS
const getCareDetails = async (req, res) => {
    try {
        const { category, subCategory } = req.query;
        const details = await CareService.findOne({ category, subCategory });
        res.json({ success: true, data: details });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { uploadCareCSV, getCareCategories, getCareSubCategories, getCareDetails };