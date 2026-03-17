// controllers/provider/Lab/LabsService.js
const LabTest = require('../../../models/LabTest');
const LabPackage = require('../../../models/LabPackage');

// 1. ADD / UPDATE TEST
// endpoint: POST /api/provider/lab/tests/save
const saveLabTest = async (req, res) => {
    try {
        const { id, ...data } = req.body;
        
        // ❌ OLD: if (req.files) data.photos = req.files.map(f => f.path);
        // ✅ NEW:
        if (req.files && req.files.photos) {
            data.photos = req.files.photos.map(f => f.path);
        }
        
        const test = id 
            ? await LabTest.findByIdAndUpdate(id, data, { new: true })
            : await LabTest.create({ labId: req.user.id, ...data });

        res.json({ success: true, data: test });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. ADD / UPDATE PACKAGE
// endpoint: POST /api/provider/lab/packages/save
const saveLabPackage = async (req, res) => {
    try {
        const { id, tests, ...data } = req.body;
        if (tests) data.tests = JSON.parse(tests);
        
        // ❌ OLD: if (req.files) data.photos = req.files.map(f => f.path);
        // ✅ NEW:
        if (req.files && req.files.photos) {
            data.photos = req.files.photos.map(f => f.path);
        }

        const packageData = id
            ? await LabPackage.findByIdAndUpdate(id, data, { new: true })
            : await LabPackage.create({ labId: req.user.id, ...data });

        res.json({ success: true, data: packageData });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. DELETE SERVICE
// endpoint: DELETE /api/provider/lab/service/delete/:type/:id
const deleteService = async (req, res) => {
    try {
        const Model = req.params.type === 'test' ? LabTest : LabPackage;
        await Model.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Deleted successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { saveLabTest, saveLabPackage, deleteService };