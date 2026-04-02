const Insurance = require('../../../models/Insurance');
const InsuranceType = require('../../../models/InsuranceType');

// 1. ADD NEW TYPE (Master Category)
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

// 2. GET ALL TYPES (Dropdown)
const getInsuranceTypes = async (req, res) => {
    try {
        const types = await InsuranceType.find({ isActive: true }).select('name -_id');
        const namesOnly = types.map(t => t.name);
        res.json({ success: true, data: namesOnly });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. ADD NEW INSURANCE (Main Insurance)
// Body: { "provider": "HDFC", "insuranceName": "HDFC ERGO", "type": "RGHS" }
const addInsurance = async (req, res) => {
    try {
        const { provider, insuranceName, type } = req.body;

        // Validation: Ab provider bhi check karenge
        if (!provider || !insuranceName || !type) {
            return res.status(400).json({ message: "Provider, Insurance Name and Type are required" });
        }

        const newInsurance = await Insurance.create({ 
            provider, 
            insuranceName, 
            type 
        });

        res.status(201).json({ success: true, data: newInsurance });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: "Insurance Name already exists" });
        }
        res.status(500).json({ message: error.message });
    }
};

// 4. GET INSURANCE LIST (Search in both Provider and Name)
const getInsuranceList = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = "" } = req.query;
        
        // Search filter: Provider ya Insurance Name dono mein search karega
        const filter = search ? {
            $or: [
                { insuranceName: { $regex: search, $options: 'i' } },
                { provider: { $regex: search, $options: 'i' } }
            ]
        } : {};

        const list = await Insurance.find(filter)
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 });

        const totalDocs = await Insurance.countDocuments(filter);
        res.json({ 
            success: true, 
            totalDocs, 
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalDocs / limit),
            data: list 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 5. UPDATE STATUS
const updateInsuranceStatus = async (req, res) => {
    try {
        const updated = await Insurance.findByIdAndUpdate(
            req.params.id, 
            { isActive: req.body.isActive }, 
            { new: true }
        );
        if (!updated) return res.status(404).json({ message: "Not found" });
        res.json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 6. UPDATE INSURANCE
const updateInsurance = async (req, res) => {
    try {
        const { provider, insuranceName, type, isActive } = req.body;

        const updated = await Insurance.findByIdAndUpdate(
            req.params.id,
            { provider, insuranceName, type, isActive },
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(404).json({ message: "Insurance not found" });
        }

        res.json({ success: true, data: updated });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: "Insurance Name already exists" });
        }
        res.status(500).json({ message: error.message });
    }
};

// 7. DELETE INSURANCE
const deleteInsurance = async (req, res) => {
    try {
        const deleted = await Insurance.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ message: "Insurance not found" });

        res.json({ success: true, message: "Insurance deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    addInsuranceType, getInsuranceTypes, 
    addInsurance, getInsuranceList, 
    updateInsuranceStatus, updateInsurance, deleteInsurance
};