const LabTest = require('../../../models/LabTest');
const LabPackage = require('../../../models/LabPackage');
const MasterLabTest = require('../../../models/MasterLabTest');


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
        const { masterTestId, amount, discountPrice, testType, description, safetyAdvice, precaution, sicknessType } = req.body;

        // Pehle Master data fetch karo
        const masterData = await MasterLabTest.findById(masterTestId);
        if (!masterData) return res.status(404).json({ message: "Invalid Master Test ID" });

        // Logic Check: Radiology me aksar Home Collection nahi hota
        if (masterData.mainCategory === 'Radiology' && testType === 'Home Collection') {
            return res.status(400).json({ message: "Radiology tests are only available as Walk-In" });
        }

        const photos = req.files ? req.files.map(f => f.path) : [];

        const newTest = await LabTest.create({
            labId: req.user.id,
            masterTestId,
            testName: masterData.testName,
            mainCategory: masterData.mainCategory,
            sampleType: masterData.sampleType,
            amount,
            discountPrice,
            testType,
            description,
            safetyAdvice,
            precaution,
            sicknessType,
            photos
        });

        res.status(201).json({ success: true, message: "Test created in your lab profile", data: newTest });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// endpoint: GET /provider/lab/tests/my-tests?mainCategory=Pathology
const getMyTests = async (req, res) => {
    try {
        const { mainCategory } = req.query; // Pathology or Radiology
        let query = { labId: req.user.id };
        if (mainCategory) query.mainCategory = mainCategory;

        const tests = await LabTest.find(query);
        res.json({ success: true, data: tests });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 2. LAB PACKAGE SECTION
// ==========================================

// endpoint: POST /api/provider/lab/packages/save
const saveLabPackage = async (req, res) => {
    try {
        const { id, tests, ...data } = req.body;
        
        // Parse tests array if coming from form-data
        if (tests) data.tests = typeof tests === 'string' ? JSON.parse(tests) : tests;
        
        if (req.files && req.files.photos) {
            data.photos = req.files.photos.map(f => f.path);
        }

        const packageData = id
            ? await LabPackage.findByIdAndUpdate(id, data, { new: true })
            : await LabPackage.create({ 
                labId: req.user.id, 
                ...data,
                totalTestsIncluded: data.tests ? data.tests.length : 0 
            });

        res.json({ success: true, message: "Package saved successfully", data: packageData });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// endpoint: GET /api/provider/lab/packages/my-packages
const getMyPackages = async (req, res) => {
    try {
        const packages = await LabPackage.find({ labId: req.user.id }).populate('tests');
        res.json({ success: true, data: packages });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 3. COMMON ACTIONS
// ==========================================

// endpoint: DELETE /api/provider/lab/service/delete/:type/:id
const deleteService = async (req, res) => {
    try {
        const Model = req.params.type === 'test' ? LabTest : LabPackage;
        const deleted = await Model.findOneAndDelete({ _id: req.params.id, labId: req.user.id });
        
        if (!deleted) return res.status(404).json({ message: "Item not found" });
        res.json({ success: true, message: "Deleted successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { getMasterList, saveLabTest, getMyTests, saveLabPackage, getMyPackages, deleteService };