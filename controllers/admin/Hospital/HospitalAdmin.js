// controllers/admin/Hospital/HospitalAdmin.js
const BedRescheduleLimit = require("../../../models/BedRescheduleLimit"); // 👈 Import Global Limit Model

// 1. UPDATE GLOBAL LIMIT (patch API)
const updateHospitalRescheduleLimit = async (req, res) => {
    try {
        const { limit } = req.body; 

        if (!limit || isNaN(Number(limit))) {
            return res.status(400).json({ success: false, message: "Valid limit number is required." });
        }

        // Global check: Agar pehle se document hai toh update hoga, nahi toh create hoga
        let config = await BedRescheduleLimit.findOne();
        if (config) {
            config.maxLimit = Number(limit);
            config.updatedBy = req.user.id;
            await config.save();
        } else {
            config = await BedRescheduleLimit.create({
                maxLimit: Number(limit),
                updatedBy: req.user.id
            });
        }

        res.json({ 
            success: true, 
            message: `Global reschedule limit successfully updated to ${limit} times for all hospitals.`, 
            data: config.maxLimit 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. GET CURRENT GLOBAL LIMIT (GET API)
const getHospitalRescheduleLimit = async (req, res) => {
    try {
        const config = await BedRescheduleLimit.findOne();
        
        // Agar DB me config document pehle se na bana ho toh safely default 2 return hoga
        const currentLimit = config ? config.maxLimit : 2;

        res.json({
            success: true,
            data: {
                maxRescheduleLimit: currentLimit
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { 
    updateHospitalRescheduleLimit, 
    getHospitalRescheduleLimit 
};