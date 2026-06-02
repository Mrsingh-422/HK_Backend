const Booking = require('../../../models/AmbulanceBooking');

// --- 1. ADMIN: GET AMBULANCE BOOKINGS ---
const adminGetAmbulanceBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;
        const { status, userId } = req.query;

        const query = {};
        if (status) query.status = status;
        if (userId) query.userId = userId; // Option to filter by specific user

        const bookings = await Booking.find(query)
            .populate('userId', 'name phone email') // Populate user who booked
            .populate('ambulanceId', 'name vehicleNumber vehicleType phone')
            .populate('hospitalId', 'name address')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Booking.countDocuments(query);

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

module.exports = { adminGetAmbulanceBookings };