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

// @desc    Get Insurance Companies List (Supports search, active filter & full dropdown export)
// @route   GET /admin/user/insurance/insurance-list
// @access  Public
const getInsuranceList = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = "", isActive, all } = req.query;
        
        const filter = {};
        if (isActive !== undefined && isActive !== 'All') {
            filter.isActive = (isActive === 'true' || isActive === true);
        }

        if (search && search.trim() !== "") {
            filter.$or = [
                { insuranceName: { $regex: search.trim(), $options: 'i' } },
                { provider: { $regex: search.trim(), $options: 'i' } },
                { type: { $regex: search.trim(), $options: 'i' } }
            ];
        }

        // Agar all=true bheja ho toh dropdowns ke liye unpaginated list milti hai
        if (all === 'true' || all === true) {
            const list = await Insurance.find(filter).sort({ provider: 1, insuranceName: 1 }).lean();
            return res.status(200).json({
                success: true,
                count: list.length,
                data: list
            });
        }

        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 10;
        const skip = (pageNum - 1) * limitNum;

        const [totalDocs, list] = await Promise.all([
            Insurance.countDocuments(filter),
            Insurance.find(filter)
                .skip(skip)
                .limit(limitNum)
                .sort({ createdAt: -1 })
                .lean()
        ]);

        res.status(200).json({ 
            success: true, 
            totalDocs, 
            currentPage: pageNum,
            totalPages: Math.ceil(totalDocs / limitNum),
            count: list.length,
            data: list 
        });

    } catch (error) {
        console.error("Get Insurance List Error:", error);
        res.status(500).json({ success: false, message: error.message });
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