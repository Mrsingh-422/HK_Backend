const Doctor = require('../../../models/Doctor'); // 👈 ADD THIS AT THE TOP IF NOT ALREADY IMPORTED
const DocRescheduleLimit = require("../../../models/DocRescheduleLimit");
const Appointment = require("../../../models/Appointment");

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



// --- 1. GET ALL DOCTORS WITH FILTERS & PAGINATION ---
// GET /admin/doctor/list?status=Pending&isActive=true&page=1&limit=10
const getDoctors = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, isActive, search } = req.query;
        
        // Strict filter taaki sirf 'doctor' role wale hi list hon
        const query = { role: 'doctor' };

        // Additional optional filters apply karein
        if (status) {
            query.profileStatus = status;
        }
        if (isActive !== undefined) {
            query.isActive = isActive === 'true';
        }
        if (search) {
            query.name = new RegExp(search, 'i'); // Case-insensitive search by name
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const doctors = await Doctor.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Doctor.countDocuments(query);

        res.json({
            success: true,
            total,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            count: doctors.length,
            data: doctors
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. APPROVE OR REJECT DOCTOR STATUS ---
// PATCH /admin/doctor/approve/:id
const approveDoctorStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, rejectionReason } = req.body; // status can be: 'Approved' or 'Rejected'

        if (!['Approved', 'Rejected', 'Pending'].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status value. Allowed: Approved, Rejected, Pending" });
        }

        const doctor = await Doctor.findById(id);
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found." });
        }

        doctor.profileStatus = status;

        if (status === 'Rejected') {
            if (!rejectionReason) {
                return res.status(400).json({ success: false, message: "Rejection reason is required when status is Rejected." });
            }
            doctor.rejectionReason = rejectionReason;
        } else {
            // Agar approve ho jata hai toh rejection reason null kar dein
            doctor.rejectionReason = null;
        }

        await doctor.save();

        res.json({
            success: true,
            message: `Doctor status successfully updated to ${status}.`,
            data: doctor
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. TOGGLE DOCTOR ACTIVE/INACTIVE STATUS ---
// PATCH /admin/doctor/toggle-active/:id
const toggleDoctorActiveStatus = async (req, res) => {
    try {
        const { id } = req.params;

        const doctor = await Doctor.findById(id);
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found." });
        }

        // True ko False aur False ko True karein
        doctor.isActive = !doctor.isActive;
        await doctor.save();

        res.json({
            success: true,
            message: `Doctor is now ${doctor.isActive ? 'Active' : 'Inactive'}.`,
            data: {
                id: doctor._id,
                isActive: doctor.isActive
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. ADMIN: GET DOCTOR APPOINTMENTS ---
const adminGetDoctorAppointments = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;
        const { status, userId } = req.query; 

        const query = { bookingType: 'Appointment' };        
        if (status) query.status = status; 
        if (userId) query.userId = userId;

        const appointments = await Appointment.find(query)
            .populate('userId', 'name phone email')
            .populate('doctorId', 'name speciality profileImage profileStatus role')
            .sort({ appointmentDate: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Appointment.countDocuments(query);

        res.json({ 
            success: true, 
            count: appointments.length, 
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: appointments 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Controller exports ko update karein
module.exports = {
    updateDocRescheduleLimit,
    getDocRescheduleLimit,
    getDoctors,
    approveDoctorStatus,
    toggleDoctorActiveStatus,
    adminGetDoctorAppointments
};