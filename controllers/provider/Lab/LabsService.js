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
        const { mainCategory, search, category } = req.query;
        let query = { isActive: true };

        if (mainCategory) query.mainCategory = mainCategory;
        if (category) query.category = category;
        if (search) query.testName = new RegExp(search, 'i');

        const list = await MasterLabTest.find(query).sort({ testName: 1 });
        res.json({ success: true, data: list });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// endpoint: GET /provider/labs/services/packages/standard-catalog
// Yeh seedha Master database se standard info dikhayega
const getStandardPackages = async (req, res) => {
    try {
        const { category, search } = req.query;
        let query = { isActive: true };
        if (category) query.category = category;
        if (search) query.packageName = new RegExp(search, 'i');

        const list = await MasterLabPackage.find(query).populate('tests', 'testName');
        res.json({ success: true, data: list });
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