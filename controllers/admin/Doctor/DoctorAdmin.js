const DocRescheduleLimit = require("../../../models/DocRescheduleLimit"); // 👈 ADD THIS AT THE TOP
// --- UPDATE DOCTOR GLOBAL LIMIT (patch API) ---
const updateDocRescheduleLimit = async (req, res) => {
    try {
        const { limit } = req.body; 

        if (!limit || isNaN(Number(limit))) {
            return res.status(400).json({ success: false, message: "Valid limit number is required." });
        }

        let config = await DocRescheduleLimit.findOne();
        if (config) {
            config.maxLimit = Number(limit);
            config.updatedBy = req.user.id;
            await config.save();
        } else {
            config = await DocRescheduleLimit.create({
                maxLimit: Number(limit),
                updatedBy: req.user.id
            });
        }

        res.json({ 
            success: true, 
            message: `Doctor global reschedule limit successfully set to ${limit} times.`, 
            data: config.maxLimit 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- GET CURRENT DOCTOR GLOBAL LIMIT (GET API) ---
const getDocRescheduleLimit = async (req, res) => {
    try {
        const config = await DocRescheduleLimit.findOne();
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
    updateDocRescheduleLimit,
    getDocRescheduleLimit
};