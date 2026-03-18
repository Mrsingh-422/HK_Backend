const MasterLabTest = require('../../../models/MasterLabTest');
const xlsx = require('xlsx');

// endpoint: POST /api/admin/master-tests/upload
const uploadMasterTests = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Upload Excel/CSV file" });

        const workbook = xlsx.readFile(req.file.path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = xlsx.utils.sheet_to_json(sheet);

        const formattedData = data.map(item => ({
            testName: item.testName,
            mainCategory: item.mainCategory, // Pathology or Radiology
            category: item.category,
            sampleType: item.sampleType || 'NA'
        }));

        await MasterLabTest.insertMany(formattedData, { ordered: false }); 
        res.json({ success: true, message: "Master Test List Updated" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


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

module.exports = { uploadMasterTests, getMasterList };