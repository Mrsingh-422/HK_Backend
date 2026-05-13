const Appointment = require('../../models/Appointment');
const Doctor = require('../../models/Doctor');
const Prescription = require('../../models/Prescription');
const moment = require('moment');
const crypto = require('crypto');

// 1. GET ALL INDEPENDENT DOCTOR BOOKINGS (Only Appointments)
// endpoint: GET /doctor/appointments/patient-bookings
const getDoctorBookings = async (req, res) => {
    try {
        const { status } = req.query;
        
        // Security Check: Only independent doctors
        if (req.user.role !== 'doctor') {
            return res.status(403).json({ message: "Access denied. Not an independent doctor." });
        }

        let query = { 
            doctorId: req.user.id, 
            bookingType: 'Appointment' // 👈 Sirf normal appointments dikheinge
        };

        if (status) query.status = status;

        const appointments = await Appointment.find(query)
            .populate('userId', 'name phone email')
            .sort({ appointmentDate: 1, appointmentTime: 1 });

        res.json({ success: true, count: appointments.length, data: appointments });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. GET TODAY'S SCHEDULE (Independent Flow)
// endpoint: GET /doctor/appointments/today-appointments
const getTodayBookings = async (req, res) => {
    try {
        const todayStart = moment().startOf('day').toDate();
        const todayEnd = moment().endOf('day').toDate();

        let query = {
            doctorId: req.user.id,
            bookingType: 'Appointment', // 👈 Strict filtering
            appointmentDate: { $gte: todayStart, $lte: todayEnd },
            status: { $in: ['Confirmed', 'In-Progress'] }
        };

        const appointments = await Appointment.find(query).populate('userId', 'name phone');
        res.json({ success: true, count: appointments.length, data: appointments });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. GET DASHBOARD STATS (Only for Appointments)
const getDoctorStats = async (req, res) => {
    try {
        const doctorId = req.user.id;
        
        const totalAppointments = await Appointment.countDocuments({ doctorId, bookingType: 'Appointment' });
        const completed = await Appointment.countDocuments({ doctorId, bookingType: 'Appointment', status: 'Completed' });
        const pending = await Appointment.countDocuments({ doctorId, bookingType: 'Appointment', status: 'Pending' });

        const appointments = await Appointment.find({ doctorId, bookingType: 'Appointment', status: 'Completed' });
        const totalRevenue = appointments.reduce((sum, item) => sum + (item.totalAmount || 0), 0);

        res.json({ 
            success: true, 
            data: { 
                totalAppointments, 
                completed, 
                pending, 
                totalRevenue, 
                rating: req.user.averageRating || 0 
            } 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. CONFIRM APPOINTMENT
const confirmAppointment = async (req, res) => {
    try {
        const appointment = await Appointment.findOneAndUpdate(
            { _id: req.params.id, doctorId: req.user.id, status: 'Pending', bookingType: 'Appointment' },
            { status: 'Confirmed' },
            { new: true }
        );
        if (!appointment) return res.status(404).json({ message: "Active appointment booking not found" });
        res.json({ success: true, message: "Appointment confirmed", data: appointment });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- Baki Actions (Start Visit, Cancel, Prescription) Same rahenge ---
// Par har jagah 'bookingType: Appointment' ka logic internally maintain hoga.

const doctorCancelAppointment = async (req, res) => {
    try {
        const { reason } = req.body;
        const appointment = await Appointment.findOne({ _id: req.params.id, doctorId: req.user.id, bookingType: 'Appointment' });
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
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const startVisit = async (req, res) => {
    try {
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        const appointment = await Appointment.findOneAndUpdate(
            { _id: req.params.id, doctorId: req.user.id, bookingType: 'Appointment' },
            { status: 'In-Progress', 'tracking.otp': otp, 'tracking.eta': 'Direct' },
            { new: true }
        );
        res.json({ success: true, message: "Visit started.", otp, data: appointment });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const completeWithPrescription = async (req, res) => {
    try {
        const { diagnosis, medicines, additionalNotes } = req.body;
        const appointment = await Appointment.findOne({ _id: req.params.id, bookingType: 'Appointment' });
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
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getMyConsultationFees = async (req, res) => {
    try {
        const doctor = await Doctor.findById(req.user.id).select('fees');
        res.json({ success: true, fees: doctor.fees });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const updateConsultationFees = async (req, res) => {
    try {
        const { online, clinic, home } = req.body;
        const updateData = {};
        if (online !== undefined) updateData['fees.online'] = Number(online);
        if (clinic !== undefined) updateData['fees.clinic'] = Number(clinic);
        if (home !== undefined) updateData['fees.home'] = Number(home);

        const updatedDoctor = await Doctor.findByIdAndUpdate(
            req.user.id, { $set: updateData }, { new: true }
        ).select('fees');
        res.json({ success: true, data: updatedDoctor.fees });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// endpoint: PATCH /doctor/appointments/reschedule/:id
const rescheduleAppointment = async (req, res) => {
    try {
        const { newDate, newTime } = req.body;
        
        const appointment = await Appointment.findOneAndUpdate(
            { 
                _id: req.params.id, 
                doctorId: req.user.id, 
                bookingType: 'Appointment',
                status: { $in: ['Pending', 'Confirmed'] } // Sirf inhi ko reschedule kar sakte hain
            },
            { 
                appointmentDate: new Date(newDate), 
                appointmentTime: newTime,
                status: 'Rescheduled' 
            },
            { new: true }
        );

        if (!appointment) return res.status(404).json({ message: "Appointment not found or cannot be rescheduled" });

        res.json({ success: true, message: "Appointment rescheduled successfully", data: appointment });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    getDoctorBookings, getTodayBookings, confirmAppointment,
    doctorCancelAppointment, startVisit, completeWithPrescription,
    getDoctorStats, getMyConsultationFees, updateConsultationFees, rescheduleAppointment
};