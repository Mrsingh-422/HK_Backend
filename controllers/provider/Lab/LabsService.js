const LabTest = require('../../../models/LabTest');
const LabPackage = require('../../../models/LabPackage');
const MasterLabTest = require('../../../models/MasterLabTest');
const MasterLabPackage = require('../../../models/MasterLabPackage');

// Helper to auto-calculate Discount Price
const calculateActualPrice = (amount, discountPercent) => {
    const discount = (amount * parseInt(discountPercent)) / 100;
    return amount - discount;
};

const getStandardCatalogTests = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const { search, mainCategory } = req.query;

        let matchQuery = { isActive: true };
        if (mainCategory) matchQuery.mainCategory = mainCategory;
        if (search) matchQuery.testName = new RegExp(search, 'i');

        const aggregate = MasterLabTest.aggregate([
            { $match: matchQuery },
            // Step 1: LabTest collection se link karo (Active vendors dhundne ke liye)
            {
                $lookup: {
                    from: "labtests", // Collection name in DB (usually lowercase plural)
                    localField: "_id",
                    foreignField: "masterTestId",
                    as: "vendorList",
                    pipeline: [{ $match: { isActive: true } }] // Sirf active vendor listings
                }
            },
            // Step 2: Ginti karo kitne vendors hain
            {
                $addFields: {
                    vendorCount: { $size: "$vendorList" }
                }
            },
            // Step 3: Sorting - Jiske vendor zyada hain wo upar (DESC), jiske 0 hain wo niche
            { $sort: { vendorCount: -1, testName: 1 } },
            // Step 4: Pagination
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limit }]
                }
            }
        ]);

        const result = await aggregate;
        const total = result[0].metadata[0]?.total || 0;

        res.json({
            success: true,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            data: result[0].data
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// endpoint: GET /provider/labs/services/packages/standard-catalog
// Yeh seedha Master database se standard info dikhayega
const getStandardPackages = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const { search, category } = req.query;

        // Note: Packages ke liye hum 'LabPackage' se start karenge taaki Custom packages bhi aayein
        // Phir hum 'packageName' par group karenge taaki unique list dikhe
        
        let matchQuery = { isActive: true };
        if (search) matchQuery.packageName = new RegExp(search, 'i');

        const aggregate = LabPackage.aggregate([
            { $match: matchQuery },
            // Step 1: Group by Master ID (for templates) or Name (for custom)
            {
                $group: {
                    _id: { $ifNull: ["$masterPackageId", "$packageName"] },
                    packageName: { $first: "$packageName" },
                    masterPackageId: { $first: "$masterPackageId" },
                    isCustom: { $first: "$isCustom" },
                    sampleType: { $first: "$sampleType" },
                    reportTime: { $first: "$reportTime" },
                    tests: { $first: "$tests" },
                    vendorCount: { $sum: 1 }, // Ginti kitne labs ne ye same package add kiya hai
                    minPrice: { $min: "$offerPrice" }
                }
            },
            // Step 2: Master information laane ke liye lookup (agar custom nahi hai)
            {
                $lookup: {
                    from: "masterlabpackages",
                    localField: "masterPackageId",
                    foreignField: "_id",
                    as: "masterInfo"
                }
            },
            { $unwind: { path: "$masterInfo", preserveNullAndEmptyArrays: true } },
            // Step 3: Final Projection (Kya data user ko dikhega)
            {
                $project: {
                    packageName: 1,
                    isCustom: 1,
                    vendorCount: 1,
                    minPrice: 1,
                    sampleType: 1,
                    tests: 1,
                    // Agar template hai toh masterInfo se description lo, warna custom wali
                    shortDescription: { $ifNull: ["$masterInfo.shortDescription", "Custom Lab Package"] },
                    category: { $ifNull: ["$masterInfo.category", "General"] },
                    standardMRP: { $ifNull: ["$masterInfo.standardMRP", "$minPrice"] }
                }
            },
            // Step 4: Sorting (Popularity/Vendors first)
            { $sort: { vendorCount: -1, packageName: 1 } },
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limit }]
                }
            }
        ]);

        // --- Step 5: Merge with Master Templates that have ZERO vendors ---
        // (Yeh part ensure karta hai ki wo templates bhi dikhe jinhe kisi lab ne add nahi kiya)
        const catalogResult = await aggregate;
        
        res.json({
            success: true,
            total: catalogResult[0].metadata[0]?.total || 0,
            currentPage: page,
            data: catalogResult[0].data
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// endpoint: GET /provider/labs/services/tests/master-tests?mainCategory=Pathology&search=diabetes
// Radiology or Pathology ke master test list ke liye
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

// ==========================================
// 1. LAB TEST SECTION (Radiology & Pathology)
// ==========================================

// endpoint: POST /provider/labs/services/add-test
const saveLabTest = async (req, res) => {
    try {
        const { id, masterTestId, amount, discountPercent, reportTime, precaution, testType, description } = req.body;
        
        const masterData = await MasterLabTest.findById(masterTestId);
        if (!masterData) return res.status(404).json({ message: "Invalid Master Test ID" });

        // Numeric Conversion
        const mrp = parseFloat(amount);
        const disc = parseFloat(discountPercent) || 0;

        // Backend Calculation (Middleware ki jagah yahan calculate kar rahe hain)
        const calculatedDiscountPrice = mrp - (mrp * (disc / 100));

        const payload = {
            labId: req.user.id,
            masterTestId,
            testName: masterData.testName,
            mainCategory: masterData.mainCategory,
            sampleType: masterData.sampleType,
            reportTime,
            precaution,
            description,
            testType,
            amount: mrp,
            discountPercent: disc,
            discountPrice: calculatedDiscountPrice // Seedha value store hogi
        };
        
        const test = id 
            ? await LabTest.findByIdAndUpdate(id, payload, { new: true })
            : await LabTest.create(payload);

        res.json({ success: true, data: test });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// endpoint: GET /provider/labs/services/tests/my-tests?mainCategory=Pathology
const getMyTests = async (req, res) => {
    try {
        const { mainCategory } = req.query; // Pathology or Radiology
        let query = { labId: req.user.id };
        if (mainCategory) query.mainCategory = mainCategory;

        const tests = await LabTest.find(query).populate('masterTestId').populate('labId', 'name').sort({ createdAt: -1 });
        res.json({ success: true, data: tests });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 2. LAB PACKAGE SECTION
// ==========================================

// endpoint: POST /provider/labs/services/packages/save
const saveLabPackage = async (req, res) => {
    try {
        const { 
            id, masterPackageId, packageName, tests, 
            mrp, discountPercent, reportTime, description, precaution,
            gender, ageGroup 
        } = req.body;

        let finalTests = [];
        let finalName = packageName;
        let finalSampleTypes = [];
        let isCustom = true;

        if (masterPackageId && masterPackageId !== "") {
            // CASE 1: Template Selection
            const masterPkg = await MasterLabPackage.findById(masterPackageId);
            if (!masterPkg) return res.status(404).json({ message: "Master Package not found" });
            
            finalTests = masterPkg.tests; // Master template ke test IDs
            finalName = masterPkg.packageName;
            // Agar Master template mein sampleTypes pehle se hain toh wo lein
            finalSampleTypes = masterPkg.sampleTypes || []; 
            isCustom = false;
        } else {
            // CASE 2: Custom Combo
            finalTests = typeof tests === 'string' ? JSON.parse(tests) : tests;
            if (!finalTests || finalTests.length === 0) {
                return res.status(400).json({ message: "No tests selected for custom package" });
            }
        }

        // AUTO-FETCH Samples (Dono cases ke liye safe side check)
        // Taaki agar master mein samples na ho toh fetch ho jaye
        if (finalSampleTypes.length === 0) {
            const testsData = await MasterLabTest.find({ _id: { $in: finalTests } });
            finalSampleTypes = [...new Set(testsData.map(t => t.sampleType))].filter(s => s);
        }

        const packageMRP = parseFloat(mrp);
        const disc = parseFloat(discountPercent) || 0;
        const calculatedOfferPrice = packageMRP - (packageMRP * (disc / 100));

        const payload = {
            labId: req.user.id,
            masterPackageId: !isCustom ? masterPackageId : null,
            isCustom,
            packageName: finalName,
            tests: finalTests,
            totalTestsIncluded: finalTests.length,
            sampleType: finalSampleTypes,
            mrp: packageMRP,
            discountPercent: disc,
            offerPrice: calculatedOfferPrice,
            reportTime, 
            description, 
            precaution,
            gender, 
            ageGroup
        };

        const result = id
            ? await LabPackage.findByIdAndUpdate(id, payload, { new: true })
            : await LabPackage.create(payload);

        res.json({ success: true, message: "Package saved successfully", data: result });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// endpoint: GET /provider/labs/services/packages/my-packages
const getMyPackages = async (req, res) => {
    try {
        const packages = await LabPackage.find({ labId: req.user.id }).populate('tests');
        res.json({ success: true, data: packages });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 3. COMMON ACTIONS
// ==========================================

// endpoint: DELETE /provider/labs/services/service/delete/:type/:id
const deleteService = async (req, res) => {
    try {
        const Model = req.params.type === 'test' ? LabTest : LabPackage;
        const deleted = await Model.findOneAndDelete({ _id: req.params.id, labId: req.user.id });
        
        if (!deleted) return res.status(404).json({ message: "Item not found" });
        res.json({ success: true, message: "Deleted successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// 4. GET SPECIFIC MASTER TEST DETAILS (Figma logic: Auto-fill fields)
// endpoint: GET /provider/lab/services/master-test-details/:masterTestId
const getMasterTestDetails = async (req, res) => {
    try {
        const test = await MasterLabTest.findById(req.params.masterTestId);
        if (!test) return res.status(404).json({ message: "Test not found" });
        res.json({ success: true, data: test });
    } catch (error) { res.status(500).json({ message: error.message }); }
};



const getMasterPackages = async (req, res) => {
    try {
        const packages = await MasterLabPackage.find({ isActive: true });
        res.json({ success: true, data: packages });
    } catch (error) { res.status(500).json({ message: error.message }); }           
}
// 5. GET SPECIFIC MASTER PACKAGE DETAILS (Figma logic: Auto-fill fields)
// endpoint: GET /provider/lab/services/master-package-details/:id
const getMasterPackageDetails = async (req, res) => {
    try {
        const pkg = await MasterLabPackage.findById(req.params.id).populate('tests');
        if (!pkg) return res.status(404).json({ message: "Not found" });
        res.json({ success: true, data: pkg });
    } catch (error) { res.status(500).json({ message: error.message }); }
};





module.exports = { getMasterList,getStandardCatalogTests, getStandardPackages, saveLabTest, getMyTests, saveLabPackage, getMyPackages, deleteService,getMasterTestDetails,getMasterPackages, getMasterPackageDetails };