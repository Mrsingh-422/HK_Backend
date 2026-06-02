const LabBooking = require('../../../models/LabBooking');

// --- 5. ADMIN: GET LAB BOOKINGS ---
const adminGetLabBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;
        const { status, userId } = req.query;

        let query = {};
        if (status) query.status = status;
        if (userId) query.userId = userId;

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

module.exports = { adminGetLabBookings };