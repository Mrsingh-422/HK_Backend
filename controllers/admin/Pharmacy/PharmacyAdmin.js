const PharmacyBooking = require('../../../models/PharmacyBooking');

// --- 6. ADMIN: GET PHARMACY BOOKINGS ---
const adminGetPharmacyBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;
        const { status, userId } = req.query;

        const query = {};
        if (status) query.status = status;
        if (userId) query.userId = userId;
        
        const orders = await PharmacyBooking.find(query)
            .populate('userId', 'name phone email')
            .populate('pharmacyId', 'name profileImage city')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await PharmacyBooking.countDocuments(query);

        res.json({
            success: true,
            count: orders.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: orders
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
module.exports = { adminGetPharmacyBookings };