const Insurance = require('../../../models/Insurance');

// 1. ADD NEW INSURANCE (Admin Only)
// Body: { "name": "RGHS" }
const addInsurance = async (req, res) => {
    try {
        const { name } = req.body;

        const exists = await Insurance.findOne({ name });
        if (exists) return res.status(400).json({ message: 'Insurance type already exists' });

        const newInsurance = await Insurance.create({ name });

        res.status(201).json({ success: true, data: newInsurance });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. GET ALL INSURANCE (Public/User/Admin - For Dropdown)
const getInsuranceList = async (req, res) => {
    try {
        // Sirf Active wale dikhao
        const list = await Insurance.find({ isActive: true }).select('name _id');
        res.json({ success: true, data: list });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { addInsurance, getInsuranceList };