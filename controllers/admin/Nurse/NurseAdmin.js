const Nurse = require('../../../models/Nurse');
const NurseBooking = require('../../../models/NurseBooking');

// --- 4. ADMIN: GET NURSE BOOKINGS ---
const adminGetNurseBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;
        const { status, userId } = req.query;

        const query = {};
        if (status) query.status = status;
        if (userId) query.userId = userId;

        const total = await NurseBooking.countDocuments(query);

        const bookings = await NurseBooking.find(query)
            .populate('userId', 'name phone email')
            .populate('nurseId', 'name profileImage speciality')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.json({ 
            success: true, 
            count: bookings.length, 
            totalItems: total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: bookings 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

module.exports = { adminGetNurseBookings };