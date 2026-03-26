const MasterLabTest = require('../../../models/MasterLabTest');
const MasterLabPackage = require('../../../models/MasterLabPackage');
const xlsx = require('xlsx');

// endpoint: POST /admin/lab/tests/upload
// Example CSV Format: 
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

module.exports = { uploadMasterTests, getMasterList, uploadMasterPackages, getMasterPackages };