// controllers/admin/Hospital/HospitalAdmin.js
const BedRescheduleLimit = require("../../../models/BedRescheduleLimit"); // 👈 Import Global Limit Model
const Appointment = require("../../../models/Appointment");
const Hospital = require("../../../models/Hospital");

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

// --- 1. ADMIN: GET APPROVED HOSPITALS LIST (Limit: 25) ---
// Endpoint: GET /admin/hospital/approved-list?page=1
const adminGetApprovedHospitals = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25;
        const skip = (page - 1) * limit;

        const query = { profileStatus: 'Approved' };

        const hospitals = await Hospital.find(query)
            .select('name address city state hospitalImage type profileStatus')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Hospital.countDocuments(query);

        res.json({
            success: true,
            count: hospitals.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: hospitals
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. ADMIN: GET HOSPITAL ADMISSION BOOKINGS (Filter by hospitalId & Limit: 25) ---
// Endpoint: GET /admin/hospital/appointments?hospitalId=ID&page=1
const adminGetHospitalBookings = async (req, res) => {
    try {
        const { tab, page = 1, status, userId, hospitalId } = req.query; // 👈 Added hospitalId
        const limit = 25; // 👈 25 items limit
        const skip = (parseInt(page) - 1) * limit;
        
        let query = { bookingType: 'Admission' };
        if (userId) query.userId = userId;
        if (hospitalId) query.hospitalId = hospitalId; // 👈 Vendor wise filter

        if (status) {
            query.status = status;
        } else if (tab === 'Upcoming') {
            query.status = 'Confirmed';
        } else if (tab === 'Pending') {
            query.status = { $in: ['Pending', 'Hospital-Pending'] };
        } else if (tab === 'History') {
            query.status = { $in: ['Completed', 'Cancelled-By-User', 'Cancelled-By-Hospital'] };
        }

        const totalCount = await Appointment.countDocuments(query);

        const data = await Appointment.find(query)
            .populate('userId', 'name phone email')
            .populate('hospitalId', 'name address hospitalImage')
            .populate('doctorId', 'name speciality profileImage')
            .populate({
                path: 'bedId',
                select: 'bedNumber status pricePerDay isVentilatorAvailable wardId',
                populate: {
                    path: 'wardId',
                    select: 'name type'
                }
            })
            .sort({ appointmentDate: 1 })
            .skip(skip)
            .limit(limit);

        res.json({ 
            success: true, 
            count: data.length,
            pagination: {
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
                currentPage: parseInt(page),
                limit
            },
            data 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

module.exports = { 
    updateHospitalRescheduleLimit, 
    getHospitalRescheduleLimit ,
    adminGetApprovedHospitals,
    adminGetHospitalBookings
};