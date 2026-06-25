const MasterLabTest = require('../../../models/MasterLabTest');
const MasterLabPackage = require('../../../models/MasterLabPackage');
const MasterRequest = require('../../../models/MasterRequest');
const xlsx = require('xlsx');
const LabCategory = require('../../../models/LabCategory');
const { deleteFile } = require('../../../utils/fileHandler');
const Medicine = require('../../../models/Medicine');

// --- 1. UPLOAD CSV / EXCEL (Optimized for 150MB+ Files & 8 Lakh Data) ---
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const MasterReportTemplate = require('../../../models/MasterReportTemplate'); 

// upload master tests // Example CSV Format: 
// endpoint: POST /admin/lab/tests/upload
// testName: CBC, parameters: Hb||WBC||RBC, faqs: What is CBC?:It is blood test||Why do it?:To check health
const uploadMasterTests = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Upload Excel/CSV file" });

        const workbook = xlsx.readFile(req.file.path);
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        const formattedData = data.map(item => ({
            testName: item.testName,
            testCode: item.testCode,
            mainCategory: item.mainCategory,
            category: item.category,
            sampleType: item.sampleType || 'NA',
            pretestPreparation: item.pretestPreparation,
            standardMRP: item.standardMRP ? parseFloat(item.standardMRP) : 0,
            
            // Logic: "Hb||WBC" -> ["Hb", "WBC"]
            parameters: item.parameters ? item.parameters.split('||').map(s => s.trim()) : [],
            
            // Logic: "Q:A || Q:A" -> [{question:Q, answer:A}]
            faqs: item.faqs ? item.faqs.split('||').map(pair => {
                const [q, a] = pair.split(':');
                return { question: q?.trim(), answer: a?.trim() };
            }) : [],

            // Logic: "Title:Desc || Title:Desc"
            detailedDescription: item.detailedDescription ? item.detailedDescription.split('||').map(pair => {
                const [title, content] = pair.split(':');
                return { sectionTitle: title?.trim(), sectionContent: content?.trim() };
            }) : []
        }));

        await MasterLabTest.insertMany(formattedData, { ordered: false }); 
        res.json({ success: true, message: "Master Test List Updated with FAQs & Details" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Upload Master Packages
// endpoint: POST admin/lab/tests/upload-packages
const uploadMasterPackages = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Upload Excel/CSV file" });

        const workbook = xlsx.readFile(req.file.path);
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        let formattedData = [];

        for (let item of data) {
            // 1. Logic: Excel se Test Names uthakar unki IDs find karna
            let testIds = [];
            if (item.tests) {
                const testNamesArray = item.tests.split('||').map(t => t.trim());
                // Database mein tests search karein
                const foundTests = await MasterLabTest.find({ testName: { $in: testNamesArray } }).select('_id');
                testIds = foundTests.map(t => t._id);
            }

            formattedData.push({
                packageName: item.packageName,
                shortDescription: item.shortDescription,
                longDescription: item.longDescription,
                mainCategory: item.mainCategory || 'Pathology',
                category: item.category,
                reportTime: item.reportTime,
                standardMRP: item.standardMRP ? parseFloat(item.standardMRP) : 0,
                
                // Foreign Keys (Tests)
                tests: testIds,
                
                // Simple Arrays: "Value1||Value2" -> ["Value1", "Value2"]
                sampleTypes: item.sampleTypes ? item.sampleTypes.split('||').map(s => s.trim()) : [],
                preparations: item.preparations ? item.preparations.split('||').map(p => p.trim()) : [],
                tags: item.tags ? item.tags.split('||').map(t => t.trim()) : [],
                lifestyleTags: item.lifestyleTags ? item.lifestyleTags.split('||').map(l => l.trim()) : [],

                // Booleans
                isFastingRequired: item.isFastingRequired === 'TRUE' || item.isFastingRequired === true,
                fastingDuration: item.fastingDuration,
                gender: item.gender || 'Both',
                ageGroup: item.ageGroup || 'All',

                // Object Arrays: "Q:A || Q:A"
                faqs: item.faqs ? item.faqs.split('||').map(pair => {
                    const [q, a] = pair.split(':');
                    return { question: q?.trim(), answer: a?.trim() };
                }) : [],

                // Object Arrays: "Title:Desc || Title:Desc"
                detailedDescription: item.detailedDescription ? item.detailedDescription.split('||').map(pair => {
                    const [title, content] = pair.split(':');
                    return { sectionTitle: title?.trim(), sectionContent: content?.trim() };
                }) : []
            });
        }

        // Database mein insert karein (Duplicates skip karne ke liye ordered: false)
        await MasterLabPackage.insertMany(formattedData, { ordered: false });
        
        res.json({ 
            success: true, 
            message: `Successfully uploaded ${formattedData.length} Master Packages` 
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 1. LIST WITH PAGINATION (20 per page) || req.params => type: 'test' or 'package'
// endpoint: GET /admin/lab/tests/list/:type
const listMasterData = async (req, res) => {
    try {
        const { type } = req.params; // 'test' or 'package'
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;

        const Model = type === 'test' ? MasterLabTest : MasterLabPackage;
        const total = await Model.countDocuments();
        
        // Initial query
        let query = Model.find().skip(skip).limit(limit).sort({ createdAt: -1 });

        // AGAR PACKAGE HAI TOH TESTS POPULATE KAREIN
        if (type === 'package') {
            query = query.populate('tests', 'testName sampleType mainCategory standardMRP'); 
            // 'tests' field ko populate kiya aur sirf kaam ke fields mangwaye
        }

        const data = await query;

        res.json({ success: true, total, page, totalPages: Math.ceil(total / limit), data });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 2. SEARCH API (POST) || req.body => type: 'test' or 'package', query
// endpoint: POST /admin/lab/tests/search
const searchMasterData = async (req, res) => {
    try {
        const { type, query } = req.body;
        const Model = type === 'test' ? MasterLabTest : MasterLabPackage;
        const searchRegex = new RegExp(query, 'i');

        const filter = type === 'test' ? { testName: searchRegex } : { packageName: searchRegex };
        const results = await Model.find(filter).limit(20);

        res.json({ success: true, data: results });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. MANUAL CREATE (Admin) || req.body => type: 'test' or 'package'
// endpoint: POST /admin/lab/tests/create
const createMasterData = async (req, res) => {
    try {
        const { type, payload } = req.body;
        const Model = type === 'test' ? MasterLabTest : MasterLabPackage;
        
        const newData = await Model.create(payload);
        res.status(201).json({ success: true, data: newData });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. EDIT API (Admin) || req.params => type: 'test' or 'package', id
const editMasterData = async (req, res) => {
    try {
        const { type, id } = req.params;
        const Model = type === 'test' ? MasterLabTest : MasterLabPackage;

        const updated = await Model.findByIdAndUpdate(id, req.body, { new: true });
        res.json({ success: true, data: updated });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ================= APPROVAL FLOW SECTION =================

// 5. GET ALL VENDOR REQUESTS (Pending)
// endpoint: GET /admin/lab/tests/requests/pending
const getPendingRequests = async (req, res) => {
    try {
        // Medicine या अन्य प्रदाताओं की रिक्वेस्ट्स को रोकने के लिए 'vendorType: "Lab"' फ़िल्टर जोड़ा गया है
        const requests = await MasterRequest.find({ 
            status: 'Pending',
            vendorType: 'Lab' // 👈 सिर्फ लैब वाले रिक्वेस्ट्स लोड होंगे
        }).populate('vendorId', 'name');

        res.json({ success: true, data: requests });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 6. APPROVE REQUEST (Moves data to Master Collection)
// endpoint: PUT /admin/lab/tests/request/approve/:requestId
const approveRequest = async (req, res) => {
    try {
        const { requestId } = req.params;
        const request = await MasterRequest.findById(requestId);
        if (!request) return res.status(404).json({ message: "Request not found" });

        const Model = request.requestType === 'Test' ? MasterLabTest : MasterLabPackage;
        
        // Move data to Master
        await Model.create(request.data);
        
        // Update Request Status
        request.status = 'Approved';
        await request.save();

        res.json({ success: true, message: "Request approved and moved to Master list" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};





// not in use
// endpoint: GET /admin/lab/tests/master-tests
const getMasterList = async (req, res) => {
    try {
        const { mainCategory, search } = req.query;
        let query = { isActive: true };
        if (mainCategory) query.mainCategory = mainCategory;
        if (search) query.testName = new RegExp(search, 'i');

        const list = await MasterLabTest.find(query);
        res.json({ success: true, data: list });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// GET MASTER PACKAGES LIST
// endpoint: GET /admin/lab/tests/master-packages
const getMasterPackages = async (req, res) => {
    try {
        const { category, search } = req.query;
        let query = { isActive: true };
        if (category) query.category = category;
        if (search) query.packageName = new RegExp(search, 'i');

        const list = await MasterLabPackage.find(query).populate('tests', 'testName sampleType');
        res.json({ success: true, data: list });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// DELETE MASTER DATA (Admin) || req.params => type: 'test' or 'package', id
const deleteMasterData = async (req, res) => {
    try {
        const { type, id } = req.params;
        const Model = type === 'test' ? MasterLabTest : MasterLabPackage;

        const deleted = await Model.findByIdAndDelete(id);
        if (!deleted) {
            return res.status(404).json({ 
                success: false, 
                message: `${type === 'test' ? 'Test' : 'Package'} not found.` 
            });
        }
        res.json({ 
            success: true, 
            message: `${type === 'test' ? 'Test' : 'Package'} deleted successfully.` 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};


// UPDATE CATEGORY IMAGE (Admin)
// endpoint: POST /admin/lab/tests/update-test-category-image
const updateCategoryImage = async (req, res) => {
    try {
        const { categoryName } = req.body;
        if (!req.file) return res.status(400).json({ message: "Please upload an image" });

        // 1. Check karein kya category pehle se exist karti hai
        let category = await LabCategory.findOne({ name: categoryName });

        if (category) {
            // Agar exist karti hai toh purani file delete karein
            if (category.image) deleteFile(category.image);
            
            category.image = req.file.path;
            await category.save();
        } else {
            // Agar nayi category hai toh create karein
            category = await LabCategory.create({
                name: categoryName,
                image: req.file.path
            });
        }

        res.json({ success: true, message: "Category image updated", data: category });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const updatePharmacyCategoryImage = async (req, res) => {
    try {
        const { categoryName } = req.body;
        if (!req.file) return res.status(400).json({ message: "Upload an image" });

        let category = await LabCategory.findOne({ name: categoryName, vendorType: 'Pharmacy' });

        if (category) {
            if (category.image) deleteFile(category.image);
            category.image = req.file.path;
            await category.save();
        } else {
            category = await LabCategory.create({
                name: categoryName,
                image: req.file.path,
                vendorType: 'Pharmacy'
            });
        }

        res.json({ success: true, data: category });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getLabCategories = async (req, res) => {
    try {
        // 1. Master tests se unique category names nikalen
        const womenCats = await MasterLabTest.distinct("category", {
            testName: { $regex: /Pap Smear|Mammography|FSH Test|LH Test|Prolactin|Ultrasound Pelvis/i },
            isActive: true
        });

        // 2. Database se images uthayen
        const dbCategories = await LabCategory.find({ name: { $in: womenCats } });

        // 3. Logic: Agar DB mein image hai toh 'public/' hatao, nahi toh fallback asset dikhao
        const finalData = womenCats.map(catName => {
            const dbMatch = dbCategories.find(dbCat => dbCat.name === catName);
            
            let imagePath;
            if (dbMatch && dbMatch.image) {
                // 'public/' ko string se remove karein
                imagePath = dbMatch.image.replace(/^public[\\/]/, ''); 
            } else {
                // Fallback asset path
                imagePath = `assets/images/women_${catName.toLowerCase().replace(" ", "_")}.png`;
            }

            return {
                name: catName,
                image: imagePath
            };
        });

        res.json({ success: true, data: finalData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// 2. Get All Pharmacy Categories (Including those without images)
const getPharmacyCategories = async (req, res) => {
    try {
        // Step 1: Medicine bread_crumb se Category nikalna
        const stats = await Medicine.aggregate([
            {
                $project: {
                    mainCat: { $trim: { input: { $arrayElemAt: [{ $split: ["$bread_crumb", ">"] }, 0] } } }
                }
            },
            { $match: { mainCat: { $ne: null, $ne: "" } } },
            { $group: { _id: "$mainCat", productCount: { $sum: 1 } } },
            { $sort: { productCount: -1 } }
        ]);

        const dbImages = await LabCategory.find({ vendorType: 'Pharmacy' });

        const finalData = stats.map(stat => {
            const dbMatch = dbImages.find(img => img.name === stat._id);
            return {
                name: stat._id,
                productCount: stat.productCount,
                image: dbMatch?.image ? dbMatch.image.replace(/^public[\\/]/, '') : null
            };
        });

        res.json({ success: true, data: finalData });
    } catch (error) { res.status(500).json({ message: error.message }); }
};







// 6. UPLOAD MASTER TEMPLATES VIA CSV
// POST: /api/admin/wallet/upload-templates-csv
// 1. BULK UPLOAD REPORT TEMPLATES VIA CSV
const uploadTemplatesCSV = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Please upload a valid CSV/Excel file." });
        }

        // 🚨 1. USE XLSX library to parse (Automatically strips carriage returns and handles both CSV & Excel!)
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        const groups = {};

        data.forEach(row => {
            // 🚨 2. KEY NORMALIZATION: Remove \r, spaces and convert to lowercase [3]
            const normalizedRow = {};
            Object.keys(row).forEach(key => {
                const cleanKey = key.replace(/\r/g, '').trim().toLowerCase();
                normalizedRow[cleanKey] = row[key];
            });

            const testName = (normalizedRow['testname'] || "").trim();
            const parameterName = (normalizedRow['parametername'] || "").trim();
            
            // 🚨 3. SMART COLUMN RESOLVER: Auto-detect any column containing 'interpret'
            const interpretationKey = Object.keys(normalizedRow).find(k => k.includes('interpret'));
            const interpText = interpretationKey ? String(normalizedRow[interpretationKey] || "").trim() : "";

            if (!testName || !parameterName) return; // Skip empty rows

            if (!groups[testName]) {
                groups[testName] = [];
            }

            // Only the very first parameter (index 0) gets the interpretation [1]
            const isFirstParam = groups[testName].length === 0;

            groups[testName].push({
                name: parameterName,
                unit: normalizedRow['unit'] ? String(normalizedRow['unit']).trim() : "",
                minRef: normalizedRow['minref'] ? String(normalizedRow['minref']).trim() : "",
                maxRef: normalizedRow['maxref'] ? String(normalizedRow['maxref']).trim() : "",
                method: normalizedRow['method'] ? String(normalizedRow['method']).trim() : "N/A",
                machine: normalizedRow['machine'] ? String(normalizedRow['machine']).trim() : "Automated Analyzer",
                interpretation: isFirstParam ? interpText : "" // 👈 Strictly saves only in first parameter! [1]
            });
        });

        // 🚨 4. Bulk upsert directly into MongoDB
        for (const testName of Object.keys(groups)) {
            await MasterReportTemplate.findOneAndUpdate(
                { testName },
                { $set: { parameters: groups[testName] } }, // parameters array has the nested interpretation!
                { upsert: true, new: true } 
            );
        }

        // Delete temporary file safely
        try {
            fs.unlinkSync(req.file.path);
        } catch (unlinkErr) {
            console.error("Temporary file delete failed:", unlinkErr.message);
        }

        res.json({
            success: true,
            message: `Successfully processed ${Object.keys(groups).length} test templates. Database updated.`
        });

    } catch (error) {
        console.error("CSV Upload Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. MANUAL CREATE REPORT TEMPLATE (Admin Panel)
const createReportTemplate = async (req, res) => {
    try {
        const { testName, parameters, interpretation } = req.body; // 👈 interpretation added

        if (!testName || !parameters || !Array.isArray(parameters) || parameters.length === 0) {
            return res.status(400).json({ success: false, message: "testName and parameters array are required." });
        }

        const exists = await MasterReportTemplate.findOne({ testName });
        if (exists) {
            return res.status(400).json({ success: false, message: "A template with this test name already exists." });
        }

        const newTemplate = await MasterReportTemplate.create({ 
            testName, 
            parameters,
            interpretation: interpretation || "" // Saved successfully
        });
        
        res.status(201).json({ success: true, message: "Template created manually successfully", data: newTemplate });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. MANUAL EDIT REPORT TEMPLATE
const editReportTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const updated = await MasterReportTemplate.findByIdAndUpdate(id, req.body, { new: true });
        
        if (!updated) {
            return res.status(404).json({ success: false, message: "Report template not found." });
        }
        res.json({ success: true, message: "Template updated successfully", data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. MANUAL DELETE REPORT TEMPLATE
const deleteReportTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await MasterReportTemplate.findByIdAndDelete(id);
        
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Report template not found." });
        }
        res.json({ success: true, message: "Report template deleted successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 7. GET: LIST ALL REPORT TEMPLATES (Admin Table View with Search & Pagination)
// endpoint: GET /admin/lab/tests/report-templates
const listReportTemplatesAdmin = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20; // Default 20 templates per page
        const skip = (page - 1) * limit;
        const { search } = req.query;

        let filter = {};
        if (search) {
            filter.testName = { $regex: search, $options: 'i' }; // Search by test name
        }

        const total = await MasterReportTemplate.countDocuments(filter);
        const templates = await MasterReportTemplate.find(filter)
            .sort({ createdAt: -1 }) // Newest templates first
            .skip(skip)
            .limit(limit);

        res.json({
            success: true,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            data: templates
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 8. GET: FETCH SINGLE TEMPLATE DETAILS (For Admin Edit/Details Form)
// endpoint: GET /admin/lab/tests/report-templates/details/:id
const getReportTemplateDetailsAdmin = async (req, res) => {
    try {
        const { id } = req.params;

        const template = await MasterReportTemplate.findById(id);
        if (!template) {
            return res.status(404).json({ success: false, message: "Report template not found." });
        }

        res.json({
            success: true,
            data: template
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};






    
module.exports = { uploadMasterTests, getMasterList, uploadMasterPackages, getMasterPackages,deleteMasterData,
                    listMasterData, searchMasterData, createMasterData, editMasterData,
                    getPendingRequests, approveRequest, updateCategoryImage, updatePharmacyCategoryImage,
                    getLabCategories, getPharmacyCategories,
                    listReportTemplatesAdmin, getReportTemplateDetailsAdmin,

                    uploadTemplatesCSV,createReportTemplate, editReportTemplate, deleteReportTemplate
 }; 