const Booking = require('../../../models/AmbulanceBooking');
const Ambulance = require('../../../models/Ambulance'); // 👈 Import Ambulance Model

// --- 1. ADMIN: GET APPROVED AMBULANCE LIST (Limit: 25) ---
// Endpoint: GET /admin/ambulance/approved-list?page=1
const adminGetApprovedAmbulances = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25; // 👈 25 items limit
        const skip = (page - 1) * limit;

        const query = { profileStatus: 'Approved' };

        const ambulances = await Ambulance.find(query)
            .select('name phone email vehicleNumber vehicleType profileStatus')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Ambulance.countDocuments(query);

        res.json({
            success: true,
            count: ambulances.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: ambulances
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. ADMIN: GET AMBULANCE BOOKINGS (Filter by ambulanceId & Limit: 25) ---
// Endpoint: GET /admin/ambulance/bookings?ambulanceId=ID&page=1
const adminGetAmbulanceBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25; // 👈 25 items limit
        const skip = (page - 1) * limit;
        const { status, userId, ambulanceId } = req.query; // 👈 Added ambulanceId filter

        const query = {};
        if (status) query.status = status;
        if (userId) query.userId = userId;
        if (ambulanceId) query.ambulanceId = ambulanceId; // 👈 Vendor wise filter

        const bookings = await Booking.find(query)
            .populate('userId', 'name phone email')
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
const toggleActiveInactiveAmbulance = async (req, res) => {
    try {
        const { ambulanceId } = req.params;
        const ambulance = await Ambulance.findById(ambulanceId);
 
        if (!ambulance) {
            return res.status(404).json({ success: false, message: "ambulance not found." });
        }
 
        ambulance.isActive = !ambulance.isActive;
        await ambulance.save();
 
        return res.json({
            success: true,
            message: `ambulance status updated to ${ambulance.isActive ? 'Active' : 'Inactive'}.`,
            data: { ambulanceId: ambulance._id,
                   isActive: ambulance.isActive
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }  
};
 const adminGetAllAmbulances = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25; // 👈 25 items limit
        const skip = (page - 1) * limit;
        const { profileStatus, search } = req.query;
 
        const query = {};
 
        // 1. Profile Status Filter (Approved, Pending, Rejected, Incomplete)
        if (profileStatus && profileStatus !== 'All') {
            query.profileStatus = profileStatus;
        }
 
        // 2. Search Filter (By Name or Phone)
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }
 
       
        const ambulances = await Ambulance.find(query)
            .select('name phone email vehicleNumber vehicleType profileStatus isActive country state city')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
 
        const total = await Ambulance.countDocuments(query);
 
        res.json({
            success: true,
            count: ambulances.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: ambulances
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
 
 

module.exports = { adminGetApprovedAmbulances, adminGetAmbulanceBookings , toggleActiveInactiveAmbulance, adminGetAllAmbulances};