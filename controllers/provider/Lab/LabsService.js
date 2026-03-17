const LabTest = require('../../../models/LabTest');
const LabPackage = require('../../../models/LabPackage');

// ==========================================
// 1. LAB TEST SECTION (Radiology & Pathology)
// ==========================================

// endpoint: POST /provider/labs/services/add-test
const saveLabTest = async (req, res) => {
    try {
        const { id, ...data } = req.body;
        
        if (req.files && req.files.photos) {
            data.photos = req.files.photos.map(f => f.path);
        }
        
        const test = id 
            ? await LabTest.findByIdAndUpdate(id, data, { new: true })
            : await LabTest.create({ labId: req.user.id, ...data });

        res.json({ success: true, message: "Test saved successfully", data: test });
    } catch (error) { res.status(500).json({ message: error.message }); }
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

module.exports = { saveLabTest, getMyTests, saveLabPackage, getMyPackages, deleteService };