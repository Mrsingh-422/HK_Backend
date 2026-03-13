const Doctor = require('../../../models/Doctor');
const Appointment = require('../../../models/Appointment');
const Specialization = require('../../../models/Specialization');
const Prescription = require('../../../models/Prescription');
const moment = require('moment');
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
        const { speciality, city, search, role, videoCall, availableNow } = req.query;
        let query = { profileStatus: 'Approved', isActive: true };

        if (speciality) query.speciality = speciality;
        if (city) query.city = { $regex: city, $options: 'i' };
        if (role) query.role = role; 
        if (search) query.name = { $regex: search, $options: 'i' };

        // Figma Toggle: Video Call available
        if (videoCall === 'true') {
            query['fees.online'] = { $gt: 0 };
        }

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
        // Patients data usually comes as stringified JSON in form-data
        const patientsData = typeof req.body.patients === 'string' 
            ? JSON.parse(req.body.patients) 
            : req.body.patients;

        const {
            doctorId, appointmentDate, appointmentTime, 
            consultationType, totalAmount 
        } = req.body;

        if (!patientsData || !Array.isArray(patientsData) || patientsData.length === 0) {
            return res.status(400).json({ message: "Please select at least one patient" });
        }

        const doctor = await Doctor.findById(doctorId);
        if (!doctor) return res.status(404).json({ message: "Doctor not found" });

        const initialStatus = doctor.role === 'hospital-doctor' ? 'Hospital-Pending' : 'Pending';
        const bookingId = `HK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        
        // 🚀 Figma Logic: Generate 4-digit OTP for Tracking
        const trackingOTP = Math.floor(1000 + Math.random() * 9000).toString();

        const newAppointment = await Appointment.create({
            userId: req.user.id,
            doctorId,
            hospitalId: doctor.hospitalId,
            patients: patientsData,
            appointmentDate,
            appointmentTime,
            consultationType,
            totalAmount,
            bookingId,
            status: initialStatus, 
            paymentStatus: 'Paid',
            'tracking.otp': trackingOTP, // Figma tracking screen ke liye
            medicalReport: req.file ? req.file.path : null // Figma: Upload Report
        });

        res.status(201).json({ 
            success: true, 
            message: "Booking Successful", 
            bookingId, 
            trackingOTP,
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
            eta: appointment.tracking?.eta || "12 min", 
            doctorLocation: appointment.tracking?.liveLocation || { lat: 30.7333, lng: 76.7794 }, 
            otp: appointment.tracking?.otp, // Database wala real OTP
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

// GET /user/doctors/slots/:doctorId?date=2026-03-20
const getAvailableSlots = async (req, res) => {
    try {
        const { doctorId } = req.params;
        const { date } = req.query; // Format: YYYY-MM-DD
        
        const doctor = await Doctor.findById(doctorId);
        const dayName = moment(date).format('ddd'); // e.g., "Mon"

        const dayConfig = doctor.availability.find(a => a.day === dayName);
        if (!dayConfig) return res.json({ success: true, message: "Doctor not available today", slots: [] });

        // Existing Bookings find karein
        const booked = await Appointment.find({ doctorId, appointmentDate: date, status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor'] } })
            .select('appointmentTime');
        const bookedTimes = booked.map(b => b.appointmentTime);

        let slots = [];
        let start = moment(dayConfig.startTime, "HH:mm");
        let end = moment(dayConfig.endTime, "HH:mm");

        while (start.isBefore(end)) {
            const timeStr = start.format("hh:mm A");
            slots.push({
                time: timeStr,
                isBooked: bookedTimes.includes(timeStr),
                isHighDemand: bookedTimes.length > 5 // Figma Indicator logic
            });
            start.add(doctor.slotDuration, 'minutes');
        }

        res.json({ success: true, date, slots });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { 
    getSpecializations, 
    searchDoctors, 
    getDoctorDetails, 
    bookAppointment, 
    getUserAppointments,
    userCancelAppointment,
    trackAppointment ,
    getMyPrescriptions,
    getAvailableSlots
};