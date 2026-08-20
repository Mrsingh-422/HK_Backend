// controllers/admin/Pharmacy/TaxConfig.js

const HsnMaster = require('../../../models/HsnMaster');

// 1. Create HSN Code Master Entry (Protected)
const createHsnCode = async (req, res) => {
    try {
        const { hsnCode, description, totalGstPercent } = req.body;

        if (!hsnCode || !description || totalGstPercent === undefined) {
            return res.status(400).json({ 
                success: false, 
                message: "All fields (hsnCode, description, totalGstPercent) are required." 
            });
        }

        const newHsn = await HsnMaster.create({
            hsnCode: hsnCode.trim(),
            description: description.trim(),
            totalGstPercent: Number(totalGstPercent)
        });

        res.status(201).json({ 
            success: true, 
            message: "HSN Code slab registered successfully!", 
            data: newHsn 
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ 
                success: false, 
                message: "This HSN Code is already registered." 
            });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. Fetch all active HSN codes (Public / Token Free)
const getHsnCodes = async (req, res) => {
    try {
        const list = await HsnMaster.find({ isActive: true }).sort({ hsnCode: 1 });
        
        res.status(200).json({ 
            success: true, 
            count: list.length, 
            data: list 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { createHsnCode, getHsnCodes };