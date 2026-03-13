const Appointment = require('../../../models/Appointment');
const Doctor = require('../../../models/Doctor');

// 1. GET ALL APPOINTMENTS OF HOSPITAL (Admin View with Pagination)
// endpoint: GET /hospital/doctor/appointments/all-bookings
const getHospitalAllBookings = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { status, doctorId, page = 1, limit = 10 } = req.query; 

        // Step 1: Sirf is hospital ke doctors ki list nikalo
        const hospitalDoctors = await Doctor.find({ hospitalId }).select('_id');
        const doctorIds = hospitalDoctors.map(doc => doc._id);

        // Step 2: Query sirf unhi doctorIds ke liye (Security check)
        let query = { doctorId: { $in: doctorIds } };

        if (status) query.status = status;
        if (doctorId) query.doctorId = doctorId;

        const appointments = await Appointment.find(query)
            .populate('doctorId', 'name speciality profileImage fees')
            .populate('userId', 'name phone email')
            .sort({ appointmentDate: -1, appointmentTime: 1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Appointment.countDocuments(query);

        res.json({ 
            success: true, 
            message: "Hospital specific bookings fetched",
            total,
            currentPage: page,
            count: appointments.length, 
            data: appointments 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. APPROVE HOSPITAL APPOINTMENT (Moves to Doctor's Dashboard)
// endpoint: PATCH /hospital/doctor/appointments/approve/:id
const approveHospitalBooking = async (req, res) => {
    try {
        const hospitalId = req.user.id;

        // Check ownership
        const appointment = await Appointment.findById(req.params.id).populate('doctorId');
        if (!appointment || String(appointment.doctorId.hospitalId) !== hospitalId) {
            return res.status(403).json({ message: "Unauthorized: Access Denied" });
        }

        // Status 'Confirmed' hote hi ye Doctor App me dikhne lagega
        appointment.status = 'Confirmed';
        await appointment.save();

        res.json({ success: true, message: "Appointment approved and sent to doctor", data: appointment });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. REJECT HOSPITAL APPOINTMENT (With Refund logic)
// endpoint: PATCH /hospital/doctor/appointments/reject/:id
const rejectHospitalBooking = async (req, res) => {
    try {
        const { reason } = req.body;
        const hospitalId = req.user.id;

        const appointment = await Appointment.findById(req.params.id).populate('doctorId');
        if (!appointment || String(appointment.doctorId.hospitalId) !== hospitalId) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        appointment.status = 'Cancelled-By-Hospital';
        appointment.paymentStatus = 'Refund-Initiated'; 
        appointment.cancellationDetails = {
            cancelledBy: hospitalId,
            reason: reason || "Rejected by hospital administration",
            cancelledAt: new Date()
        };

        await appointment.save();
        res.json({ success: true, message: "Appointment rejected and refund initiated", data: appointment });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 4. GET HOSPITAL APPOINTMENT STATS (For Dashboard Cards)
// endpoint: GET /hospital/doctor/appointments/stats
const getHospitalAppointmentStats = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const hospitalDoctors = await Doctor.find({ hospitalId }).select('_id');
        const doctorIds = hospitalDoctors.map(doc => doc._id);

        const stats = await Appointment.aggregate([
            { $match: { doctorId: { $in: doctorIds } } },
            { $group: {
                _id: null,
                totalBookings: { $sum: 1 },
                pendingApprovals: { $sum: { $cond: [{ $eq: ["$status", "Hospital-Pending"] }, 1, 0] } },
                totalRevenue: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, "$totalAmount", 0] } },
                completedVisits: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } }
            }}
        ]);

        res.json({ 
            success: true, 
            data: stats[0] || { totalBookings: 0, pendingApprovals: 0, totalRevenue: 0, completedVisits: 0 } 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    getHospitalAllBookings, 
    approveHospitalBooking, 
    rejectHospitalBooking,
    getHospitalAppointmentStats 
};