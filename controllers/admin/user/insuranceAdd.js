const Insurance = require('../../../models/Insurance');
const InsuranceType = require('../../../models/InsuranceType');

// 1. ADD NEW TYPE (Master Category banane ke liye)
// POST | Body: { "name": "RGHS" }
const addInsuranceType = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ message: 'Name is required' });

        const newType = await InsuranceType.create({ name });
        res.status(201).json({ success: true, data: newType });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. GET ALL TYPES (Dropdown ke liye - Sirf names bhejenge)
// GET | Frontend dropdown me ye list dikhayega
const getInsuranceTypes = async (req, res) => {
    try {
        const types = await InsuranceType.find({ isActive: true }).select('name -_id');
        const namesOnly = types.map(t => t.name); // Sirf names ka array ["RGHS", "CGHS"]
        res.json({ success: true, data: namesOnly });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. ADD NEW INSURANCE (Main Insurance)
// POST | Body: { "insuranceName": "HDFC", "type": "RGHS" }
const addInsurance = async (req, res) => {
    try {
        const { insuranceName, type } = req.body;

        // Check: Kya Postman se insuranceName aa raha hai?
        if (!insuranceName || !type) {
            return res.status(400).json({ message: "insuranceName and type are required" });
        }

        const newInsurance = await Insurance.create({ insuranceName, type });
        res.status(201).json({ success: true, data: newInsurance });
    } catch (error) {
        // Agar fir bhi duplicate error aaye toh yahan dikhega
        res.status(500).json({ message: error.message });
    }
};

// 4. GET INSURANCE LIST (With Search & Pagination)
const getInsuranceList = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = "" } = req.query;
        const filter = search ? { insuranceName: { $regex: search, $options: 'i' } } : {};

        const list = await Insurance.find(filter)
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 });

        const totalDocs = await Insurance.countDocuments(filter);
        res.json({ success: true, totalDocs, data: list });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 5. UPDATE STATUS
const updateInsuranceStatus = async (req, res) => {
    try {
        const updated = await Insurance.findByIdAndUpdate(req.params.id, { isActive: req.body.isActive }, { new: true });
        res.json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    addInsuranceType, getInsuranceTypes, 
    addInsurance, getInsuranceList, 
    updateInsuranceStatus 
};