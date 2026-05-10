const Appointment = require('../../../models/Appointment');
const Ward = require('../../../models/Ward');

// 1. GET ALL BOOKINGS (Bifurcated for Appointments and Admissions)
// endpoint: GET /hospital/doctor/appointments/all-bookings?bookingType=Appointment&status=Hospital-Pending
const getHospitalAllBookings = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { status, bookingType, triageLevel, page = 1, limit = 10 } = req.query; 

        // Direct hospitalId query for efficiency
        let query = { hospitalId: hospitalId };

        if (status) query.status = status;
        if (bookingType) query.bookingType = bookingType; // 'Appointment' or 'Admission'
        if (triageLevel) query.triageLevel = triageLevel; // 'Emergency', 'Routine' etc.

        const appointments = await Appointment.find(query)
            .populate('doctorId', 'name speciality profileImage')
            // .populate('bedId', 'bedType pricePerDay') // Populate Bed details
            .populate('userId', 'name phone email profilePic')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Appointment.countDocuments(query);

        res.json({ 
            success: true, 
            total,
            currentPage: Number(page),
            count: appointments.length, 
            data: appointments 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. APPROVE BOOKING (Moves to Confirmed)
const approveHospitalBooking = async (req, res) => {
    try {
        const hospitalId = req.user.id;

        const appointment = await Appointment.findOne({ _id: req.params.id, hospitalId });
        if (!appointment) return res.status(404).json({ message: "Booking not found" });

        appointment.status = 'Confirmed';
        
        // Agar Admission (Bed) hai, toh status Occupied kar dein
        if (appointment.bookingType === 'Admission' && appointment.bedId) {
             await Ward.updateOne(
                { "beds._id": appointment.bedId }, 
                { $set: { "beds.$.status": "Occupied" } }
             );
        }

        await appointment.save();
        res.json({ success: true, message: "Booking approved successfully", data: appointment });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. REJECT BOOKING (With Bed Release Logic)
const rejectHospitalBooking = async (req, res) => {
    try {
        const { reason } = req.body;
        const hospitalId = req.user.id;

        const appointment = await Appointment.findOne({ _id: req.params.id, hospitalId });
        if (!appointment) return res.status(404).json({ message: "Booking not found" });

        appointment.status = 'Cancelled-By-Hospital';
        appointment.paymentStatus = 'Refund-Initiated'; 
        appointment.cancellationDetails = {
            cancelledBy: hospitalId,
            reason: reason || "Hospital rejected the request",
            cancelledAt: new Date()
        };

        // Agar Bed reserved thi, toh wapas Available karein
        if (appointment.bedId) {
            await Ward.updateOne(
                { "beds._id": appointment.bedId }, 
                { $set: { "beds.$.status": "Available" } }
            );
        }

        await appointment.save();
        res.json({ success: true, message: "Booking rejected and bed released", data: appointment });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 4. DASHBOARD STATS (Screenshot 4 Mapping)
// endpoint: GET /hospital/doctor/appointments/stats
const getHospitalStats = async (req, res) => {
    try {
        const hospitalId = req.user.id;

        const stats = await Appointment.aggregate([
            { $match: { hospitalId: new mongoose.Types.ObjectId(hospitalId) } },
            { $group: {
                _id: null,
                emergencyCases: { $sum: { $cond: [{ $eq: ["$triageLevel", "Emergency"] }, 1, 0] } },
                newAdmissions: { $sum: { $cond: [{ $eq: ["$bookingType", "Admission"] }, 1, 0] } },
                dischargesPending: { $sum: { $cond: [{ $eq: ["$status", "Confirmed"] }, 1, 0] } }, // Ready for discharge
                totalRevenue: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, "$totalAmount", 0] } }
            }}
        ]);

        const data = stats[0] || { emergencyCases: 0, newAdmissions: 0, dischargesPending: 0, totalRevenue: 0 };

        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    getHospitalAllBookings, 
    approveHospitalBooking, 
    rejectHospitalBooking,
    getHospitalStats 
};