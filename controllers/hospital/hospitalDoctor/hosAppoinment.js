const Appointment = require('../../../models/Appointment');
const Doctor = require('../../../models/Doctor');

// 1. GET ALL APPOINTMENTS OF HOSPITAL (Admin View)
// endpoint: GET /hospital/doctor/appointments/all-bookings
const getHospitalAllBookings = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { status, doctorId } = req.query; 

        // Step 1: Sirf is hospital ke doctors ki list nikalo
        const hospitalDoctors = await Doctor.find({ hospitalId }).select('_id');
        const doctorIds = hospitalDoctors.map(doc => doc._id);

        // Step 2: Query sirf unhi doctorIds ke liye chalegi (Security check)
        let query = { doctorId: { $in: doctorIds } };

        // Filters: ?status=Hospital-Pending etc.
        if (status) query.status = status;
        if (doctorId) query.doctorId = doctorId;

        const appointments = await Appointment.find(query)
            .populate('doctorId', 'name speciality profileImage')
            .populate('userId', 'name phone email')
            .sort({ appointmentDate: 1, appointmentTime: 1 });

        res.json({ 
            success: true, 
            message: "Hospital specific bookings fetched",
            count: appointments.length, 
            data: appointments 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. APPROVE HOSPITAL APPOINTMENT (Hospital Admin action)
// endpoint: PATCH /hospital/doctor/appointments/approve/:id
const approveHospitalBooking = async (req, res) => {
    try {
        const hospitalId = req.user.id;

        // Pehle check karein ki ye appointment isi hospital ke doctor ka hai ya nahi
        const appointment = await Appointment.findById(req.params.id).populate('doctorId');
        
        if (!appointment || String(appointment.doctorId.hospitalId) !== hospitalId) {
            return res.status(403).json({ message: "Unauthorized: This appointment belongs to another hospital or doctor" });
        }

        // Status ko 'Confirmed' set karein taaki doctor dashboard me dikhne lage
        appointment.status = 'Confirmed';
        await appointment.save();

        res.json({ success: true, message: "Appointment approved and sent to doctor's dashboard", data: appointment });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. REJECT HOSPITAL APPOINTMENT (Hospital Admin action)
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
        appointment.paymentStatus = 'Refunded'; // Direct Hospital rejection usually means full refund
        appointment.cancellationDetails = {
            cancelledBy: hospitalId,
            reason: reason || "Rejected by hospital administration",
            cancelledAt: new Date()
        };

        await appointment.save();
        res.json({ success: true, message: "Appointment rejected by hospital", data: appointment });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { getHospitalAllBookings, approveHospitalBooking, rejectHospitalBooking };