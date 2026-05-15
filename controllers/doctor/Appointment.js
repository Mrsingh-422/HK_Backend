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
// ---------------------------------
// 1. GET ALL PRESCRIPTIONS (Figma: Screen 1 - List View)
// endpoint: GET /doctor/prescriptions?filter=all OR ?filter=today
const getAllPrescriptions = async (req, res) => {
    try {
        const { filter } = req.query;
        let query = { doctorId: req.user.id };
 
        // Today's filter logic
        if (filter === 'today') {
            const startDay = moment().startOf('day').toDate();
            const endDay = moment().endOf('day').toDate();
            query.createdAt = { $gte: startDay, $lte: endDay };
        }
 
        const prescriptions = await Prescription.find(query)
            .populate('userId', 'name phone profileImage')
            .populate({
                path: 'appointmentId',
                select: 'patients appointmentTime status'
            })
            .sort({ createdAt: -1 });
 
        // Formatting for Figma UI
        const formattedData = prescriptions.map(p => ({
            id: p._id,
            patientName: p.appointmentId?.patients[0]?.patientName || p.userId?.name,
            phone: p.userId?.phone,
            symptoms: p.diagnosis.join(', '),
            date: moment(p.createdAt).format('DD MMM, hh:mm A'),
            status: 'Sent' // Figma UI badge
        }));
 
        res.json({ success: true, count: prescriptions.length, data: formattedData });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
 
// 2. GET PRESCRIPTION DETAILS (Figma: Screen 2 - Detail View)
// endpoint: GET /doctor/prescriptions/:id
const getPrescriptionDetails = async (req, res) => {
    try {
        const prescription = await Prescription.findById(req.params.id)
            .populate('userId', 'name phone')
            .populate('appointmentId');
 
        if (!prescription) return res.status(404).json({ message: "Prescription not found" });
 
        // Logic for "Delivery Info" section in Figma
        const deliveryInfo = {
            sentTo: prescription.userId?.name,
            sentTime: moment(prescription.createdAt).format('hh:mm A'),
            status: 'Delivered' // Mock status as per design
        };
 
        res.json({
            success: true,
            data: {
                patientInfo: {
                    name: prescription.appointmentId?.patients[0]?.patientName || prescription.userId?.name,
                    age: prescription.appointmentId?.patients[0]?.patientAge,
                    gender: prescription.appointmentId?.patients[0]?.gender,
                    phone: prescription.userId?.phone
                },
                clinicalDetails: {
                    symptoms: prescription.additionalNotes, // Or map from diagnosis
                    diagnosis: prescription.diagnosis,
                    medicines: prescription.medicines
                },
                deliveryInfo
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
 
// 3. EDIT PRESCRIPTION (Figma: "Edit" Button)
const updatePrescription = async (req, res) => {
    try {
        const updatedPrescription = await Prescription.findOneAndUpdate(
            { _id: req.params.id, doctorId: req.user.id },
            { $set: req.body },
            { new: true }
        );
        res.json({ success: true, message: "Prescription updated", data: updatedPrescription });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
 
// 4. RESEND PRESCRIPTION (Figma: "Resend" Button)
const resendPrescription = async (req, res) => {
    try {
        const prescription = await Prescription.findById(req.params.id);
        if (!prescription) return res.status(404).json({ message: "Not found" });
 
        // Yahan aap SMS ya WhatsApp notification trigger ka logic likh sakte hain
        res.json({ success: true, message: "Prescription resent successfully to patient" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
// POST: Create a new prescription
// endpoint: POST /doctor/prescriptions/create
const createPrescription = async (req, res) => {
    try {
        const {
            userId,
            appointmentId,
            diagnosis,
            medicines,
            additionalNotes,
            isManualUpload,
            prescriptionImages
        } = req.body;
 
        // 1. Create Prescription Entry
        const newPrescription = new Prescription({
            doctorId: req.user.id,
            userId,
            appointmentId: appointmentId || null,
            diagnosis,
            medicines,
            additionalNotes,
            isManualUpload: isManualUpload || false,
            prescriptionImages: prescriptionImages || []
        });
 
        const savedPrescription = await newPrescription.save();
 
        // 2. Agar Appointment ID hai, toh Appointment Status update karein
        if (appointmentId) {
            await Appointment.findByIdAndUpdate(appointmentId, {
                status: 'Completed'
            });
        }
 
        res.status(201).json({
            success: true,
            message: "Prescription created successfully",
            data: savedPrescription
        });
 
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// endpoint: GET /doctor/appointments/patient-history
const getPatientHistory = async (req, res) => {
    try {
        const doctorId = req.user.id;
 
        // Fetch completed appointments for this doctor
        const history = await Appointment.find({
            doctorId,
            bookingType: 'Appointment',
            status: 'Completed' // History usually implies finished visits
        })
        .populate('userId', 'profileImage') // To get patient profile picture
        .sort({ appointmentDate: -1 });
 
        // Formatting data for the Figma List UI
        const formattedHistory = history.map(app => ({
            appointmentId: app._id,
            patientName: app.patients[0]?.patientName || "Unknown",
            // Merging address fields for the subtitle in Figma
            location: `${app.address.houseNo}, ${app.address.sector} ${app.address.city}`,
            profileImage: app.userId?.profileImage || null,
        }));
 
        res.json({
            success: true,
            count: formattedHistory.length,
            data: formattedHistory
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
 
 
// endpoint: GET /doctor/appointments/patient-history/:id
const getPatientHistoryDetails = async (req, res) => {
    try {
        const appointmentId = req.params.id;
 
        // 1. Get Appointment Data
        const appointment = await Appointment.findById(appointmentId)
            .populate('userId', 'phone profileImage');
 
        if (!appointment) return res.status(404).json({ message: "Appointment not found" });
 
        // 2. Get Prescription Data associated with this appointment
        const prescription = await Prescription.findOne({ appointmentId });
 
        // Formatting data to match Figma Detail UI sections
        const responseData = {
            patientInfo: {
                name: appointment.patients[0]?.patientName,
                age: appointment.patients[0]?.patientAge,
                gender: appointment.patients[0]?.gender,
                bloodGroup: "O+", // Note: Not in model, adding as placeholder/mock
                phone: appointment.userId?.phone,
                profileImage: appointment.userId?.profileImage,
                address: `${appointment.address.houseNo}, ${appointment.address.landmark}, ${appointment.address.city}, ${appointment.address.pincode}`
            },
            consultationSummary: {
                diagnosis: prescription?.diagnosis || [],
                symptoms: appointment.patients[0]?.reasonForVisit || "Not specified",
                doctorNotes: prescription?.additionalNotes || "No notes provided",
                mode: appointment.consultationType, // e.g., 'Home Visit' -> 'Home'
                duration: "45 mins" // Placeholder as duration is not in schema
            },
            prescription: prescription?.medicines.map(m => ({
                medicineName: m.name,
                dosage: m.dosage,
                instruction: m.instruction,
                duration: m.duration
            })) || [],
            paymentDetails: {
                consultationFee: appointment.pricingBreakdown.baseFee,
                platformFee: appointment.pricingBreakdown.extraCharges || 50,
                totalPaid: appointment.totalAmount,
                paymentMode: "UPI" // Usually derived from transaction info
            }
        };
 
        res.json({ success: true, data: responseData });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    getDoctorBookings, getTodayBookings, confirmAppointment,
    doctorCancelAppointment, startVisit, completeWithPrescription,
    getDoctorStats, getMyConsultationFees, updateConsultationFees, rescheduleAppointment,getAllPrescriptions,
    getPrescriptionDetails, updatePrescription, resendPrescription, createPrescription,
    getPatientHistory, getPatientHistoryDetails

};