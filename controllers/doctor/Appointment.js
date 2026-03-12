const Appointment = require('../../models/Appointment');
const moment = require('moment');
const crypto = require('crypto');

// 1. GET ALL DOCTOR BOOKINGS
// endpoint: GET /doctor/appointments/patient-bookings
const getDoctorBookings = async (req, res) => {
    try {
        const { status } = req.query;
        const isHospitalDoctor = req.user.role === 'hospital-doctor';

        let query = { doctorId: req.user.id };

        // Logic: Hospital doctor ko 'Hospital-Pending' wali bookings nahi dikhni chahiye
        if (isHospitalDoctor) {
            query.status = { $nin: ['Hospital-Pending', 'Cancelled-By-Hospital'] };
        }

        if (status) query.status = status;

        const appointments = await Appointment.find(query)
            .populate('userId', 'name phone email')
            .sort({ appointmentDate: 1, appointmentTime: 1 });

        res.json({ success: true, count: appointments.length, data: appointments });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. GET TODAY'S SCHEDULE (Figma Dashboard)
// endpoint: GET /doctor/appointments/today-appointments
const getTodayBookings = async (req, res) => {
    try {
        const todayStart = moment().startOf('day').toDate();
        const todayEnd = moment().endOf('day').toDate();

        let query = {
            doctorId: req.user.id,
            appointmentDate: { $gte: todayStart, $lte: todayEnd },
            status: { $in: ['Confirmed', 'In-Progress'] } // Sirf actionable dikhao
        };

        const appointments = await Appointment.find(query).populate('userId', 'name phone');

        res.json({ success: true, count: appointments.length, data: appointments });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. CONFIRM/ACCEPT APPOINTMENT (Sirf Independent Doctors ke liye useful)
// endpoint: PATCH /doctor/appointments/confirm/:id
const confirmAppointment = async (req, res) => {
    try {
        // Sirf 'Pending' status se 'Confirmed' ho sakta hai
        const appointment = await Appointment.findOneAndUpdate(
            { _id: req.params.id, doctorId: req.user.id, status: 'Pending' },
            { status: 'Confirmed' },
            { new: true }
        );

        if (!appointment) return res.status(404).json({ message: "Booking not found or already approved" });

        res.json({ success: true, message: "Appointment confirmed", data: appointment });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 4. CANCEL BY DOCTOR
// endpoint: PATCH /doctor/appointments/cancel/:id
const doctorCancelAppointment = async (req, res) => {
    try {
        const { reason } = req.body;
        const appointment = await Appointment.findOne({ _id: req.params.id, doctorId: req.user.id });

        if (!appointment) return res.status(404).json({ message: "Appointment not found" });

        appointment.status = 'Cancelled-By-Doctor';
        appointment.paymentStatus = 'Refunded'; 
        appointment.cancellationDetails = {
            cancelledBy: req.user.id,
            reason: reason || "Doctor unavailable",
            cancelledAt: new Date()
        };

        await appointment.save();
        res.json({ success: true, message: "Appointment cancelled. Refund initiated.", data: appointment });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 5. START VISIT (Figma: Generate OTP & Update Tracking)
// endpoint: PATCH /doctor/appointments/start-visit/:id
const startVisit = async (req, res) => {
    try {
        // OTP generate karein agar nahi hai (Figma tracking screen ke liye)
        const otp = Math.floor(1000 + Math.random() * 9000).toString();

        const appointment = await Appointment.findOneAndUpdate(
            { _id: req.params.id, doctorId: req.user.id },
            { 
                status: 'In-Progress',
                'tracking.otp': otp,
                'tracking.eta': 'Direct'
            },
            { new: true }
        );

        res.json({ success: true, message: "Visit started. Share OTP with patient if required.", otp, data: appointment });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 6. COMPLETE APPOINTMENT
// endpoint: POST /doctor/appointments/complete/:id
const completeWithPrescription = async (req, res) => {
    try {
        const { diagnosis, medicines, additionalNotes } = req.body;
        const appointmentId = req.params.id;

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) return res.status(404).json({ message: "Appointment not found" });

        // 1. Create Prescription
        const prescription = await Prescription.create({
            appointmentId,
            doctorId: req.user.id,
            userId: appointment.userId,
            diagnosis,
            medicines,
            additionalNotes
        });

        // 2. Update Appointment Status
        appointment.status = 'Completed';
        await appointment.save();

        res.status(201).json({ success: true, message: "Prescription added and appointment completed", data: prescription });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    getDoctorBookings, 
    getTodayBookings, 
    confirmAppointment,
    doctorCancelAppointment,
    startVisit,
    completeWithPrescription
};