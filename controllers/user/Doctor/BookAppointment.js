const Doctor = require('../../../models/Doctor');
const Appointment = require('../../../models/Appointment');
const Specialization = require('../../../models/Specialization');
const Prescription = require('../../../models/Prescription');
const crypto = require('crypto');

// 1. GET ALL SPECIALIZATIONS (For dropdown)
// endpoint: GET /user/doctors/specializations
const getSpecializations = async (req, res) => {
    try {
        const list = await Specialization.find({ isActive: true });
        res.json({ success: true, data: list });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. SEARCH & FILTER DOCTORS (Website & App Listing)
// endpoint: GET /user/doctors/list?speciality=Cardiologist&city=Mohali
const searchDoctors = async (req, res) => {
    try {
        const { speciality, city, search, role } = req.query;
        let query = { profileStatus: 'Approved', isActive: true };

        if (speciality) query.speciality = speciality;
        if (city) query.city = { $regex: city, $options: 'i' };
        if (role) query.role = role; 
        if (search) query.name = { $regex: search, $options: 'i' };

        const doctors = await Doctor.find(query)
            .select('-password -token')
            .populate('hospitalId', 'name');

        res.json({ success: true, count: doctors.length, data: doctors });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. GET DOCTOR PROFILE DETAILS
// endpoint: GET /user/doctors/details/:id
const getDoctorDetails = async (req, res) => {
    try {
        const doctor = await Doctor.findById(req.params.id).populate('hospitalId', 'name address');
        if (!doctor) return res.status(404).json({ message: "Doctor not found" });
        res.json({ success: true, data: doctor });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 4. BOOK APPOINTMENT (Hospital-Aware Logic)
// endpoint: POST /user/doctors/book
const bookAppointment = async (req, res) => {
    try {
        const {
            doctorId, patients, appointmentDate, appointmentTime, 
            consultationType, totalAmount 
        } = req.body;

        if (!patients || !Array.isArray(patients) || patients.length === 0) {
            return res.status(400).json({ message: "Please select at least one patient" });
        }

        // --- 🚀 NEW LOGIC: Role based status check ---
        const doctor = await Doctor.findById(doctorId);
        if (!doctor) return res.status(404).json({ message: "Doctor not found" });

        // Agar Hospital Doctor hai toh status 'Hospital-Pending' jayega
        // Agar Independent hai toh status 'Pending' jayega
        const initialStatus = doctor.role === 'hospital-doctor' ? 'Hospital-Pending' : 'Pending';

        const bookingId = `HK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        const newAppointment = await Appointment.create({
            userId: req.user.id,
            doctorId,
            patients,
            appointmentDate,
            appointmentTime,
            consultationType,
            totalAmount,
            bookingId,
            status: initialStatus, 
            paymentStatus: 'Paid'
        });

        res.status(201).json({ 
            success: true, 
            message: initialStatus === 'Hospital-Pending' 
                ? "Appointment Booked. Waiting for Hospital approval." 
                : "Appointment Booked. Waiting for Doctor confirmation.", 
            bookingId, 
            data: newAppointment 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 5. GET USER APPOINTMENTS (Figma: My Bookings)
// endpoint: GET /user/doctors/my-appointments
const getUserAppointments = async (req, res) => {
    try {
        const { status } = req.query; 
        const query = { userId: req.user.id };
        
        // Status filters can include: Pending, Hospital-Pending, Confirmed, etc.
        if (status) query.status = status;

        const appointments = await Appointment.find(query)
            .populate('doctorId', 'name speciality profileImage profileStatus role')
            .sort({ appointmentDate: -1 });

        res.json({ success: true, count: appointments.length, data: appointments });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}; 

// 6. CANCEL APPOINTMENT (User Side)
// endpoint: PATCH /user/doctors/cancel/:id
const userCancelAppointment = async (req, res) => {
    try {
        const { reason } = req.body;
        const appointment = await Appointment.findOne({ _id: req.params.id, userId: req.user.id });

        if (!appointment) return res.status(404).json({ message: "Appointment not found" });
        
        // Block cancellation if already in progress or completed
        if (['In-Progress', 'Completed'].includes(appointment.status)) {
            return res.status(400).json({ message: "Cannot cancel appointment in its current state" });
        }

        appointment.status = 'Cancelled-By-User';
        appointment.cancellationDetails = {
            cancelledBy: req.user.id,
            reason: reason || "Cancelled by user",
            cancelledAt: new Date()
        };
        
        appointment.paymentStatus = 'Refund-Initiated'; 

        await appointment.save();
        res.json({ success: true, message: "Appointment cancelled. Refund initiated.", data: appointment });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 7. TRACK LIVE STATUS (Figma Tracking Screen)
// endpoint: GET /user/doctors/track/:appointmentId
const trackAppointment = async (req, res) => {
    try {
        const appointment = await Appointment.findOne({ 
            _id: req.params.appointmentId, 
            userId: req.user.id 
        }).populate('doctorId', 'name phone profileImage');

        if (!appointment) return res.status(404).json({ message: "Appointment not found" });

        res.json({ 
            success: true, 
            status: appointment.status,
            eta: "12 min", 
            doctorLocation: { lat: 30.7333, lng: 76.7794 }, 
            otp: "8902", // Figma OTP Simulation
            data: appointment 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

//8. GET PRESCRIPTION & DIAGNOSIS (Figma: Prescription View Button)
// endpoint: GET /user/doctors/prescription
const getMyPrescriptions = async (req, res) => {
    try {
        const data = await Prescription.find({ userId: req.user.id })
            .populate('doctorId', 'name speciality profileImage')
            .sort({ createdAt: -1 });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    getSpecializations, 
    searchDoctors, 
    getDoctorDetails, 
    bookAppointment, 
    getUserAppointments,
    userCancelAppointment,
    trackAppointment ,
    getMyPrescriptions
};