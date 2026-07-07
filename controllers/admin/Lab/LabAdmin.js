const LabBooking = require('../../../models/LabBooking');
const Lab = require('../../../models/Lab');

// --- 1. ADMIN: GET APPROVED LABS LIST (Limit: 25) ---
// Endpoint: GET /admin/lab/approved-list?page=1
const adminGetApprovedLabs = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25;
        const skip = (page - 1) * limit;

        const query = { profileStatus: 'Approved' };

        const labs = await Lab.find(query)
            .select('name email phone city profileImage profileStatus')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Lab.countDocuments(query);

        res.json({
            success: true,
            count: labs.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: labs
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. ADMIN: GET LAB BOOKINGS (Filter by labId & Limit: 25) ---
// Endpoint: GET /admin/lab/bookings?labId=ID&page=1
const adminGetLabBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25; // 👈 25 items limit
        const skip = (page - 1) * limit;
        const { status, userId, labId } = req.query; // 👈 Added labId

        let query = {};
        if (status) query.status = status;
        if (userId) query.userId = userId;
        if (labId) query.labId = labId; // 👈 Vendor wise filter

        const bookings = await LabBooking.find(query)
            .populate('userId', 'name phone email')
            .populate('labId', 'name city profileImage')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await LabBooking.countDocuments(query);
            
        res.json({ 
            success: true, 
            count: bookings.length, 
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: bookings 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};
const toggleActiveInactiveLab = async (req, res) => {
    try {
        const { labId } = req.params;
        const lab = await Lab.findById(labId);
 
        if (!lab) {
            return res.status(404).json({ success: false, message: "Lab not found." });
        }
 
        lab.isActive = !lab.isActive;
        await lab.save();
 
        return res.json({
            success: true,
            message: `Lab status updated to ${lab.isActive ? 'Active' : 'Inactive'}.`,
            data: { labId: lab._id,
                   isActive: lab.isActive
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }  
};
 
module.exports = { adminGetApprovedLabs,adminGetLabBookings ,toggleActiveInactiveLab};