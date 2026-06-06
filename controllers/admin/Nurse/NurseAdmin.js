const Nurse = require('../../../models/Nurse');
const NurseBooking = require('../../../models/NurseBooking');

// --- 1. ADMIN: GET APPROVED NURSES LIST (Limit: 25) ---
// Endpoint: GET /admin/nurse/approved-list?page=1
const adminGetApprovedNurses = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25;
        const skip = (page - 1) * limit;

        const query = { profileStatus: 'Approved' };

        const nurses = await Nurse.find(query)
            .select('name email phone speciality profileImage profileStatus')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Nurse.countDocuments(query);

        res.json({
            success: true,
            count: nurses.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: nurses
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. ADMIN: GET NURSE BOOKINGS (Filter by nurseId & Limit: 25) ---
// Endpoint: GET /admin/nurse/bookings?nurseId=ID&page=1
const adminGetNurseBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25; // 👈 25 items limit
        const skip = (page - 1) * limit;
        const { status, userId, nurseId } = req.query; // 👈 Added nurseId

        const query = {};
        if (status) query.status = status;
        if (userId) query.userId = userId;
        if (nurseId) query.nurseId = nurseId; // 👈 Vendor wise filter

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

module.exports = {adminGetApprovedNurses, adminGetNurseBookings };