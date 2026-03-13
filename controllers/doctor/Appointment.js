const Appointment = require('../../models/Appointment');
const Doctor = require('../../models/Doctor');
const Prescription = require('../../models/Prescription');
const moment = require('moment');
const crypto = require('crypto');

// 1. GET ALL DOCTOR BOOKINGS
// endpoint: GET /doctor/appointments/patient-bookings
const getDoctorBookings = async (req, res) => {
    try {
        const { status } = req.query;
        const isHospitalDoctor = req.user.role === 'hospital-doctor';
        let query = { doctorId: req.user.id };

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

// 2. GET TODAY'S SCHEDULE
// endpoint: GET /doctor/appointments/today-appointments
const getTodayBookings = async (req, res) => {
    try {
        const todayStart = moment().startOf('day').toDate();
        const todayEnd = moment().endOf('day').toDate();

        let query = {
            doctorId: req.user.id,
            appointmentDate: { $gte: todayStart, $lte: todayEnd },
            status: { $in: ['Confirmed', 'In-Progress'] }
        };

        const appointments = await Appointment.find(query).populate('userId', 'name phone');
        res.json({ success: true, count: appointments.length, data: appointments });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. CONFIRM/ACCEPT APPOINTMENT
// endpoint: PATCH /doctor/appointments/confirm/:id
const confirmAppointment = async (req, res) => {
    try {
        const appointment = await Appointment.findOneAndUpdate(
            { _id: req.params.id, doctorId: req.user.id, status: 'Pending' },
            { status: 'Confirmed' },
            { new: true }
        );
        if (!appointment) return res.status(404).json({ message: "Booking not found" });
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

// 5. START VISIT
// endpoint: PATCH /doctor/appointments/start-visit/:id
const startVisit = async (req, res) => {
    try {
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        const appointment = await Appointment.findOneAndUpdate(
            { _id: req.params.id, doctorId: req.user.id },
            { status: 'In-Progress', 'tracking.otp': otp, 'tracking.eta': 'Direct' },
            { new: true }
        );
        res.json({ success: true, message: "Visit started.", otp, data: appointment });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 6. COMPLETE APPOINTMENT WITH PRESCRIPTION
// endpoint: POST /doctor/appointments/complete/:id
const completeWithPrescription = async (req, res) => {
    try {
        const { diagnosis, medicines, additionalNotes } = req.body;
        const appointment = await Appointment.findById(req.params.id);
        if (!appointment) return res.status(404).json({ message: "Appointment not found" });

        const prescription = await Prescription.create({
            appointmentId: req.params.id,
            doctorId: req.user.id,
            userId: appointment.userId,
            diagnosis,
            medicines,
            additionalNotes
        });

        appointment.status = 'Completed';
        await appointment.save();
        res.status(201).json({ success: true, message: "Prescription added and completed", data: prescription });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 7. UPDATE LIVE LOCATION
// endpoint: PATCH /doctor/appointments/update-location/:id
const updateLiveLocation = async (req, res) => {
    try {
        const { lat, lng } = req.body;
        await Appointment.findByIdAndUpdate(req.params.id, {
            'tracking.liveLocation.lat': lat,
            'tracking.liveLocation.lng': lng,
            'tracking.liveLocation.lastUpdated': new Date()
        });
        res.json({ success: true, message: "Live location synced" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 8. START VIDEO CALL
// endpoint: POST /doctor/appointments/start-video/:id
const startVideoCall = async (req, res) => {
    try {
        const roomId = `HK-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
        const appointment = await Appointment.findByIdAndUpdate(
            req.params.id,
            { videoRoomId: roomId, status: 'In-Progress' },
            { new: true }
        );
        res.json({ success: true, roomId, message: "Video Meeting Room Created" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 9. UPDATE DOCTOR PROFILE & FEES (Figma Requirement)
// endpoint: PATCH /doctor/appointments/update-settings
const updateDoctorSettings = async (req, res) => {
    try {
        const { about, experienceYears, languages, fees } = req.body;
        const updatedDoctor = await Doctor.findByIdAndUpdate(
            req.user.id,
            { about, experienceYears, languages, fees },
            { new: true }
        );
        res.json({ success: true, message: "Profile settings updated", data: updatedDoctor });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 10. SET AVAILABILITY SLOTS
// endpoint: POST /doctor/appointments/set-availability
const setAvailability = async (req, res) => {
    try {
        const { availability, slotDuration } = req.body; // availability: [{day, startTime, endTime}]
        const updatedDoctor = await Doctor.findByIdAndUpdate(
            req.user.id,
            { availability, slotDuration },
            { new: true }
        );
        res.json({ success: true, message: "Availability slots updated", data: updatedDoctor });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 11. GET DASHBOARD STATS
// endpoint: GET /doctor/appointments/stats
const getDoctorStats = async (req, res) => {
    try {
        const totalAppointments = await Appointment.countDocuments({ doctorId: req.user.id });
        const completed = await Appointment.countDocuments({ doctorId: req.user.id, status: 'Completed' });
        const pending = await Appointment.countDocuments({ doctorId: req.user.id, status: 'Pending' });

        const appointments = await Appointment.find({ doctorId: req.user.id, status: 'Completed' });
        const totalRevenue = appointments.reduce((sum, item) => sum + item.totalAmount, 0);

        res.json({ 
            success: true, 
            data: { totalAppointments, completed, pending, totalRevenue, rating: req.user.averageRating } 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { 
    getDoctorBookings, getTodayBookings, confirmAppointment,
    doctorCancelAppointment, startVisit, completeWithPrescription,
    updateLiveLocation, startVideoCall, updateDoctorSettings,
    setAvailability, getDoctorStats
};