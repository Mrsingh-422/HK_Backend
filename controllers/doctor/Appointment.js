const Appointment = require('../../models/Appointment');
const Doctor = require('../../models/Doctor');
const Prescription = require('../../models/Prescription');
const Medicine = require('../../models/Medicine');
const moment = require('moment');
const crypto = require('crypto');
const mongoose = require('mongoose');
const NoShowConfig = require('../../models/NoShowConfig');
const DocReschleduleLimit = require('../../models/DocRescheduleLimit');


// GET: Doctor Dashboard Stats
// endpoint: GET /doctor/dashboard/summary
const getVendorDashboard = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const todayStart = moment().startOf('day').toDate();
        const todayEnd = moment().endOf('day').toDate();

        // 1. BASIC COUNTERS (Total vs Today)
        const stats = await Appointment.aggregate([
            { $match: { doctorId: new mongoose.Types.ObjectId(doctorId), bookingType: 'Appointment' } },
            {
                $group: {
                    _id: null,
                    totalBookings: { $sum: 1 },
                    completed: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
                    pending: { $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] } },
                    cancelled: { $sum: { $cond: [{ $in: ["$status", ["Cancelled-By-Doctor", "Cancelled-By-User"]] }, 1, 0] } },
                    totalRevenue: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, "$totalAmount", 0] } }
                }
            }
        ]);

        const dashboardStats = stats[0] || { totalBookings: 0, completed: 0, pending: 0, cancelled: 0, totalRevenue: 0 };

        // 2. TODAY'S SPECIFIC STATS
        const todayStats = await Appointment.aggregate([
            { 
                $match: { 
                    doctorId: new mongoose.Types.ObjectId(doctorId), 
                    bookingType: 'Appointment',
                    appointmentDate: { $gte: todayStart, $lte: todayEnd }
                } 
            },
            {
                $group: {
                    _id: null,
                    todayCount: { $sum: 1 },
                    todayRevenue: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, "$totalAmount", 0] } }
                }
            }
        ]);

        const todaySummary = todayStats[0] || { todayCount: 0, todayRevenue: 0 };

        // 3. CONSULTATION TYPE BREAKDOWN (Figma Chart Data)
        const breakdown = await Appointment.aggregate([
            { $match: { doctorId: new mongoose.Types.ObjectId(doctorId), bookingType: 'Appointment' } },
            {
                $group: {
                    _id: "$consultationType",
                    count: { $sum: 1 }
                }
            }
        ]);

        // 4. RECENT APPOINTMENTS (Last 5)
        const recentAppointments = await Appointment.find({ doctorId, bookingType: 'Appointment' })
            .populate('userId', 'name profileImage')
            .sort({ createdAt: -1 })
            .limit(5)
            .select('patients appointmentDate appointmentTime status totalAmount consultationType');

        // 5. DOCTOR PROFILE INFO (Rating & Status)
        const doctorInfo = await Doctor.findById(doctorId).select('averageRating totalReviews dutyStatus profileStatus');

        res.json({
            success: true,
            data: {
                counters: {
                    totalBookings: dashboardStats.totalBookings,
                    completed: dashboardStats.completed,
                    pending: dashboardStats.pending,
                    cancelled: dashboardStats.cancelled,
                    totalRevenue: dashboardStats.totalRevenue,
                    todayBookings: todaySummary.todayCount,
                    todayRevenue: todaySummary.todayRevenue
                },
                doctorProfile: {
                    rating: doctorInfo.averageRating,
                    reviews: doctorInfo.totalReviews,
                    dutyStatus: doctorInfo.dutyStatus,
                    profileStatus: doctorInfo.profileStatus
                },
                consultationBreakdown: breakdown, // Useful for Pie Charts
                recentActivity: recentAppointments
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// 1. GET ALL INDEPENDENT DOCTOR BOOKINGS (Only Appointments)
// endpoint: GET /doctor/appointments/patient-bookings
const getDoctorBookings = async (req, res) => {
    try {
        const { status, consultationType } = req.query;
        
        if (req.user.role !== 'doctor') {
            return res.status(403).json({ message: "Access denied. Not an independent doctor." });
        }

        let query = { 
            doctorId: req.user.id, 
            bookingType: 'Appointment' 
        };

        if (status) query.status = status;

        if (consultationType) {
            const lowerType = consultationType.toLowerCase();
            if (lowerType === 'video' || lowerType === 'video consult') {
                query.consultationType = 'Video Consult';
            } else if (lowerType === 'clinic' || lowerType === 'clinic visit') {
                query.consultationType = 'Clinic Visit';
            } else if (lowerType === 'home' || lowerType === 'home visit') {
                query.consultationType = 'Home Visit';
            } else {
                query.consultationType = consultationType;
            }
        }

        const appointments = await Appointment.find(query)
            .populate('userId', 'name phone email')
            .sort({ appointmentDate: -1, appointmentTime: -1 });

        // Fetch platform global limits configuration (fallback is 2)
        const globalConfig = await DocReschleduleLimit.findOne() || { maxLimit: 2 };
        const maxLimit = globalConfig.maxLimit || 2;

        // 🚀 SYNC FIX: Inject dynamic limits into the doctor's patient cards list response
        const formattedData = appointments.map(app => {
            const appObj = app.toObject ? app.toObject() : { ...app };
            const currentRescheduleCount = appObj.rescheduleCount || 0;
            const currentCancelCount = appObj.cancellationCount || 0;

            appObj.remainingReschedules = Math.max(0, maxLimit - currentRescheduleCount);
            appObj.remainingCancellations = Math.max(0, maxLimit - currentCancelCount);
            return appObj;
        });

        res.json({ success: true, count: formattedData.length, data: formattedData });
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
        const { reason, isPermanent = false } = req.body; // isPermanent: true (Auto-Refund) | false (Free Reschedule)
        
        const appointment = await Appointment.findOne({ 
            _id: req.params.id, 
            doctorId: req.user.id, 
            bookingType: 'Appointment' 
        });
        
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment not found" });
        }

        // 🚀 CRITICAL SECURITY CHECK: Block cancellation if the appointment is already finalized or closed [1]
        const terminalStates = ['Completed', 'Cancelled-By-Doctor', 'Cancelled-By-User', 'No-Show'];
        if (terminalStates.includes(appointment.status)) {
            return res.status(400).json({ 
                success: false, 
                message: `Cancellation Blocked: Appointment is already in '${appointment.status}' state.` 
            });
        }

        const totalPaid = appointment.totalAmount || 0;

        if (isPermanent === true || isPermanent === "true") {
            // Permanent Cancellation: Sets state to refund-ready and reverses subscription benefit counts
            appointment.status = 'Cancelled-By-Doctor';
            appointment.paymentStatus = 'Refund-Initiated'; // Full refund triggers under this state [1]
            
            appointment.cancellationDetails = {
                cancelledBy: req.user.id,
                reason: reason || "Doctor unavailable",
                cancelledAt: new Date(),
                isPermanent: true,
                refundAmountCalculated: totalPaid,
                penaltyApplied: 0
            };

            // Subscription benefit refund: Reverses the consumed consult count if applicable [1]
            if (appointment.subscriptionDetails?.isSubscriptionApplied && appointment.pricingBreakdown?.baseFee === 0) {
                await refundBenefitCount(appointment.userId, 'freeDoctorAppointmentsCount');
            }
        } else {
            // Temporary Cancellation: Free Reschedule authorization granted to user, payment remains active
            appointment.status = 'Cancelled-By-Doctor';
            appointment.paymentStatus = 'Paid'; // Payment remains captured
            
            appointment.cancellationDetails = {
                cancelledBy: req.user.id,
                reason: reason || "Doctor rescheduled shift",
                cancelledAt: new Date(),
                isPermanent: false,
                refundAmountCalculated: 0,
                penaltyApplied: 0
            };
        }

        await appointment.save();

        res.json({ 
            success: true, 
            message: isPermanent 
                ? "Appointment cancelled permanently. Full refund initiated for the patient."
                : "Appointment cancelled. The patient has been authorized to reschedule for free.", 
            data: appointment 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
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
        const { appointmentId, newDate, newTimeSlot } = req.body;

        if (!appointmentId || !newDate || !newTimeSlot) {
            return res.status(400).json({ success: false, message: "Appointment, Date, and TimeSlot are mandatory." });
        }

        const appt = await Appointment.findOne({ 
            _id: appointmentId, 
            doctorId: req.user.id,
            "cancellationDetails.isPermanent": { $ne: true } 
        });

        if (!appt) {
            return res.status(404).json({ 
                success: false, 
                message: "Reschedule Blocked: Appointment record not found, or permanently cancelled." 
            });
        }

        // 🚀 SYNC FIX: Block doctor rescheduling if consultation is finalized, in-progress, or No-Show
        const blockedStates = ['Completed', 'In-Progress', 'No-Show'];
        if (blockedStates.includes(appt.status)) {
            return res.status(400).json({ 
                success: false, 
                message: `Reschedule Blocked: Consultation is already in '${appt.status}' state.` 
            });
        }

        const globalConfig = await DocReschleduleLimit.findOne();
        const maxLimit = globalConfig ? globalConfig.maxLimit : 2;

        const currentRescheduleCount = appt.rescheduleCount || 0;

        if (currentRescheduleCount >= maxLimit) {
            return res.status(400).json({
                success: false,
                message: `Reschedule failed: Aapki maximum reschedule limit (${maxLimit} times) poori ho chuki hai.`
            });
        }

        const isBooked = await Appointment.findOne({
            _id: { $ne: appointmentId },
            doctorId: appt.doctorId,
            appointmentDate: new Date(newDate),
            appointmentTime: newTimeSlot,
            status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor'] }
        });

        if (isBooked) {
            return res.status(400).json({ success: false, message: "Naya selected slot pehle se hi kisi aur patient ke liye booked hai." });
        }

        appt.appointmentDate = new Date(newDate);
        appt.appointmentTime = newTimeSlot;
        appt.rescheduleCount = currentRescheduleCount + 1;
        appt.status = 'Confirmed'; 

        appt.cancellationDetails = undefined;

        await appt.save();
        res.json({ success: true, message: "Appointment rescheduled successfully", data: appt });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid ID format. Must be a 24-character hexadecimal string." 
            });
        }

        const prescription = await Prescription.findOne({
            $or: [
                { _id: id },
                { appointmentId: id }
            ]
        })
        .populate({
            path: 'userId',
            select: 'name phone gender dob userAddress profilePic'
        })
        .populate({
            path: 'appointmentId',
            select: 'bookingId appointmentDate appointmentTime patients address consultationType'
        });

        if (!prescription) {
            return res.status(404).json({ 
                success: false, 
                message: `Prescription not found for the provided ID: ${id}` 
            });
        }

        let patientProfile = {
            appointmentId: "N/A",
            date: moment(prescription.createdAt).format('DD/MM/YYYY'),
            time: moment(prescription.createdAt).format('hh:mm A'),
            name: "Unknown",
            gender: "N/A",
            age: "N/A",
            address: "N/A"
        };

        const appointment = prescription.appointmentId;
        const user = prescription.userId;

        if (appointment) {
            const targetPatient = appointment.patients?.[0];
            patientProfile.appointmentId = appointment.bookingId || "N/A";
            patientProfile.date = appointment.appointmentDate 
                ? moment(appointment.appointmentDate).format('DD/MM/YYYY') 
                : patientProfile.date;
            patientProfile.time = appointment.appointmentTime || patientProfile.time;
            patientProfile.name = targetPatient?.patientName || user?.name || "Patient";
            patientProfile.gender = targetPatient?.gender || user?.gender || "N/A";
            patientProfile.age = targetPatient?.patientAge ? `${targetPatient.patientAge} Years` : "N/A";

            const addr = appointment.address;
            if (addr) {
                patientProfile.address = [
                    addr.houseNo,
                    addr.sector,
                    addr.landmark,
                    addr.city,
                    addr.pincode ? `- ${addr.pincode}` : ''
                ]
                .filter(part => part && part.trim() !== '')
                .join(', ')
                .replace(', -', ' -');
            }
        } else if (user) {
            patientProfile.name = user.name;
            patientProfile.gender = user.gender || "N/A";
            if (user.dob) {
                const birthDate = moment(user.dob);
                const years = moment().diff(birthDate, 'years');
                patientProfile.age = `${years} Years`;
            }

            const defaultAddr = user.userAddress?.find(addr => addr.isDefault) || user.userAddress?.[0];
            if (defaultAddr) {
                patientProfile.address = [
                    defaultAddr.houseNo,
                    defaultAddr.sector,
                    defaultAddr.landmark,
                    defaultAddr.city,
                    defaultAddr.pincode ? `- ${defaultAddr.pincode}` : ''
                ]
                .filter(part => part && part.trim() !== '')
                .join(', ')
                .replace(', -', ' -');
            }
        }

        res.json({
            success: true,
            data: {
                patientDetails: patientProfile,
                clinicalDetails: {
                    chiefComplaints: prescription.chiefComplaints || "",
                    diagnosis: prescription.diagnosis || [],
                    medicines: prescription.medicines || [],
                    
                    // 🚀 SYNC FIX: Explicitly maps and returns saved vitals inside clinicalDetails so frontend can render them!
                    vitals: prescription.vitals || { bp: "", pulse: "", temp: "", spo2: "" }
                },
                advisedSections: {
                    advisedInvestigations: prescription.advisedInvestigations || "None",
                    adviceGiven: prescription.adviceGiven || "",
                    specialInstructions: prescription.specialInstructions || "",
                    nextAppointment: prescription.nextAppointment || ""
                },
                pdfUrl: prescription.pdfUrl || null,
                createdAt: prescription.createdAt
            }
        });

    } catch (error) {
        console.error("Error in getPrescriptionDetails:", error);
        res.status(500).json({ success: false, message: error.message });
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

// GET: Fetch complete clinical header details for a specific active appointment
// Endpoint: GET /doctor/appointments/details/:id
const getAppointmentClinicalDetails = async (req, res) => {
    try {
        const appointmentId = req.params.id;

        // Query the appointment and populate patient base user account and prescribing doctor profile
        const appointment = await Appointment.findOne({
            _id: appointmentId,
            doctorId: req.user.id
        })
        .populate('userId', 'name phone email profilePic')
        .populate('doctorId', 'name qualification speciality councilNumber councilName licensingAuthority');

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment record not found." });
        }

        // Identify the target patient from the patients array (typically the first index)
        const primaryPatient = appointment.patients?.[0] || {};

        // Format user's clinical address dynamically
        const addr = appointment.address;
        const formattedAddress = addr
            ? `${addr.houseNo ? addr.houseNo + ', ' : ''}${addr.sector ? addr.sector + ', ' : ''}${addr.landmark ? addr.landmark + ', ' : ''}${addr.city || ''}, ${addr.state || ''} - ${addr.pincode || ''}`
            : "Address Not Specified";

        // Map data strictly to match the headers shown on your prescription screenshot
        const responseData = {
            appointmentHeader: {
                appointmentId: appointment.bookingId || appointment._id,
                appointmentDate: moment(appointment.appointmentDate).format('DD/MM/YYYY'),
                appointmentTime: appointment.appointmentTime || "N/A",
                consultationType: appointment.consultationType
            },
            patientDetails: {
                patientMongoId: primaryPatient._id || null,
                name: primaryPatient.patientName || appointment.userId?.name || "N/A",
                age: primaryPatient.patientAge || "N/A",
                gender: primaryPatient.gender || "N/A",
                address: formattedAddress,
                phone: appointment.userId?.phone || "N/A",
                reasonForVisit: primaryPatient.reasonForVisit || ""
            },
            doctorCredentials: {
                name: appointment.doctorId?.name,
                qualifications: appointment.doctorId?.qualification || "MBBS, MD", // Matches "MBBS, MD" from image
                speciality: appointment.doctorId?.speciality || "General Physician",
                councilDetails: appointment.doctorId?.councilNumber 
                    ? `${appointment.doctorId.councilName || 'Medical Council'} No. : ${appointment.doctorId.councilNumber}`
                    : "Not Registered" // Matches "Punjab Medical Council No. : 162542"
            }
        };

        res.json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error("Error fetching clinical details:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// --- CREATE PRESCRIPTION (With Vitals & Secure Call OTP Verification Lock) ---
// Endpoint: POST /doctor/appointments/create-prescription
const createPrescription = async (req, res) => {
    try {
        const {
            userId,
            appointmentId,
            chiefComplaints,
            diagnosis,
            medicines, 
            advisedInvestigations,
            adviceGiven,
            specialInstructions,
            nextAppointment,
            additionalNotes
        } = req.body;

        let targetUserId = userId; // Base assignment

        // 🚀 SYNC FIX 1: Secure ObjectId Validation for appointmentId to prevent CastError crashes
        const isValidApptId = appointmentId && mongoose.Types.ObjectId.isValid(appointmentId);

        if ((!targetUserId || targetUserId === "null" || targetUserId === "undefined") && isValidApptId) {
            const appointmentRef = await Appointment.findById(appointmentId);
            if (appointmentRef) {
                targetUserId = appointmentRef.userId;
            }
        }

        // Validate final targetUserId format before querying database
        const isValidUserId = targetUserId && mongoose.Types.ObjectId.isValid(targetUserId);
        if (!isValidUserId) {
            return res.status(400).json({ success: false, message: "Validation Blocked: A valid User/Patient ID is required." });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: "Compiled prescription PDF file is missing." });
        }

        // SECURE OTP LOCK VALIDATION: For Video consultations, verify OTP check is true
        if (isValidApptId) {
            const appointment = await Appointment.findById(appointmentId);
            if (appointment && appointment.consultationType === 'Video Consult') {
                if (appointment.tracking?.isOtpVerified !== true) {
                    return res.status(400).json({ 
                        success: false, 
                        message: "Prescription Blocked: Video consultation has not been verified via User OTP yet. Verify OTP during active call to proceed." 
                    });
                }
            }
        }

        // 🚀 SYNC FIX 2: Try-Catch wrapper on medicines JSON parsing to prevent SyntaxError crashes
        let parsedMedicines = [];
        if (medicines) {
            try {
                parsedMedicines = typeof medicines === 'string' ? JSON.parse(medicines) : medicines;
            } catch (e) {
                console.error("SyntaxError: Failed to parse medicines JSON:", e.message);
                parsedMedicines = []; // Safe fallback
            }
        }

        // 🚀 SYNC FIX 3: Try-Catch wrapper on diagnosis JSON parsing to prevent SyntaxError crashes
        let parsedDiagnosis = [];
        if (diagnosis) {
            try {
                parsedDiagnosis = typeof diagnosis === 'string' ? JSON.parse(diagnosis) : diagnosis;
            } catch (e) {
                console.error("SyntaxError: Failed to parse diagnosis JSON:", e.message);
                parsedDiagnosis = []; // Safe fallback
            }
        }

        // Robust Vitals Parser 
        let finalVitals = { bp: "", pulse: "", temp: "", spo2: "" };

        // Option A: Direct Flat Keys
        if (req.body.bp !== undefined) finalVitals.bp = req.body.bp;
        if (req.body.pulse !== undefined) finalVitals.pulse = req.body.pulse;
        if (req.body.temp !== undefined) finalVitals.temp = req.body.temp;
        if (req.body.spo2 !== undefined) finalVitals.spo2 = req.body.spo2;

        // Option B: Flutter Multipart Nested Keys
        if (req.body['vitals[bp]'] !== undefined) finalVitals.bp = req.body['vitals[bp]'];
        if (req.body['vitals[pulse]'] !== undefined) finalVitals.pulse = req.body['vitals[pulse]'];
        if (req.body['vitals[temp]'] !== undefined) finalVitals.temp = req.body['vitals[temp]'];
        if (req.body['vitals[spo2]'] !== undefined) finalVitals.spo2 = req.body['vitals[spo2]'];

        // Option C: JSON stringified or raw nested Object
        if (req.body.vitals) {
            try {
                const parsedVitals = typeof req.body.vitals === 'string' 
                    ? JSON.parse(req.body.vitals) 
                    : req.body.vitals;
                
                if (parsedVitals && typeof parsedVitals === 'object') {
                    if (parsedVitals.bp !== undefined) finalVitals.bp = parsedVitals.bp;
                    if (parsedVitals.pulse !== undefined) finalVitals.pulse = parsedVitals.pulse;
                    if (parsedVitals.temp !== undefined) finalVitals.temp = parsedVitals.temp;
                    if (parsedVitals.spo2 !== undefined) finalVitals.spo2 = parsedVitals.spo2;
                }
            } catch (e) {
                console.error("Error parsing vitals object:", e.message);
            }
        }

        // Create new prescription document including Vitals
        const newPrescription = new Prescription({
            doctorId: req.user.id,
            userId: targetUserId, 
            appointmentId: isValidApptId ? appointmentId : null,
            chiefComplaints: chiefComplaints || "",
            diagnosis: parsedDiagnosis || [],
            medicines: parsedMedicines || [],
            advisedInvestigations: advisedInvestigations || "None",
            adviceGiven: adviceGiven || "",
            specialInstructions: specialInstructions || "",
            nextAppointment: nextAppointment || "",
            additionalNotes: additionalNotes || "",
            isManualUpload: false,
            pdfUrl: `/uploads/doctor_prescriptions/${req.file.filename}`,
            vitals: finalVitals 
        });

        const savedPrescription = await newPrescription.save();

        if (isValidApptId) {
            await Appointment.findByIdAndUpdate(appointmentId, {
                status: 'Completed'
            });
        }

        res.status(201).json({
            success: true,
            message: "Prescription successfully generated and saved!",
            data: savedPrescription
        });

    } catch (error) {
        console.error("Prescription Creation Error:", error);
        res.status(500).json({ success: false, message: "Internal Server Error: " + error.message });
    }
};

// --- COMPLETE WITH PRESCRIPTION (Direct API fallback) ---
const completeWithPrescription = async (req, res) => {
    try {
        const { appointmentId, diagnosis, medicines, additionalNotes } = req.body;
        const targetId = appointmentId || req.params.id;

        const appointment = await Appointment.findOne({ _id: targetId, bookingType: 'Appointment' });
        if (!appointment) return res.status(404).json({ message: "Appointment not found" });

        // SECURE OTP LOCK VALIDATION: For Video consultations, verify OTP check is true
        if (appointment.consultationType === 'Video Consult') {
            if (appointment.tracking?.isOtpVerified !== true) {
                return res.status(400).json({ 
                    success: false, 
                    message: "Prescription Blocked: Video consultation has not been verified via User OTP yet." 
                });
            }
        }

        // 🚀 SYNC FIX: Self-Healing Multi-Format Vitals Parser 
        let finalVitals = { bp: "", pulse: "", temp: "", spo2: "" };

        // Option A: Direct Flat Keys
        if (req.body.bp !== undefined) finalVitals.bp = req.body.bp;
        if (req.body.pulse !== undefined) finalVitals.pulse = req.body.pulse;
        if (req.body.temp !== undefined) finalVitals.temp = req.body.temp;
        if (req.body.spo2 !== undefined) finalVitals.spo2 = req.body.spo2;

        // Option B: Flutter Multipart Nested Keys
        if (req.body['vitals[bp]'] !== undefined) finalVitals.bp = req.body['vitals[bp]'];
        if (req.body['vitals[pulse]'] !== undefined) finalVitals.pulse = req.body['vitals[pulse]'];
        if (req.body['vitals[temp]'] !== undefined) finalVitals.temp = req.body['vitals[temp]'];
        if (req.body['vitals[spo2]'] !== undefined) finalVitals.spo2 = req.body['vitals[spo2]'];

        // Option C: JSON stringified or raw nested Object
        if (req.body.vitals) {
            try {
                const parsedVitals = typeof req.body.vitals === 'string' 
                    ? JSON.parse(req.body.vitals) 
                    : req.body.vitals;
                
                if (parsedVitals && typeof parsedVitals === 'object') {
                    if (parsedVitals.bp !== undefined) finalVitals.bp = parsedVitals.bp;
                    if (parsedVitals.pulse !== undefined) finalVitals.pulse = parsedVitals.pulse;
                    if (parsedVitals.temp !== undefined) finalVitals.temp = parsedVitals.temp;
                    if (parsedVitals.spo2 !== undefined) finalVitals.spo2 = parsedVitals.spo2;
                }
            } catch (e) {
                console.error("Error parsing vitals in completeWithPrescription:", e.message);
            }
        }

        const prescription = await Prescription.create({
            appointmentId: targetId,
            doctorId: req.user.id,
            userId: appointment.userId,
            diagnosis,
            medicines,
            additionalNotes,
            vitals: finalVitals
        });

        appointment.status = 'Completed';
        await appointment.save();
        res.status(201).json({ success: true, message: "Prescription added and completed", data: prescription });
    } catch (error) { res.status(500).json({ message: error.message }); }
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
                bloodGroup: "O+", // Placeholder
                phone: appointment.userId?.phone,
                profileImage: appointment.userId?.profileImage,
                address: `${appointment.address.houseNo}, ${appointment.address.landmark}, ${appointment.address.city}, ${appointment.address.pincode}`
            },
            consultationSummary: {
                diagnosis: prescription?.diagnosis || [],
                symptoms: appointment.patients[0]?.reasonForVisit || "Not specified",
                doctorNotes: prescription?.additionalNotes || "No notes provided",
                mode: appointment.consultationType, 
                duration: "45 mins",
                
                // 🚀 SYNC FIX: Returns recorded vitals for this historical consultation!
                vitals: prescription?.vitals || { bp: "", pulse: "", temp: "", spo2: "" }
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
                paymentMode: "UPI" 
            }
        };
 
        res.json({ success: true, data: responseData });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// GET: Fetch appointments eligible for Video Consultation
// endpoint: GET /doctor/appointments/video-consults
const getDoctorVideoConsults = async (req, res) => {
    try {
        const doctorId = req.user.id; // Decoded from protect('doctor') middleware

        // Mongoose query with strict validation rules
        const appointments = await Appointment.find({
            doctorId,
            bookingType: 'Appointment',            // Only normal appointment bookings
            consultationType: 'Video Consult',      // Only Video consultations
            status: { $in: ['Confirmed', 'In-Progress'] } // Active states only
        })
        .populate('userId', 'name phone profilePic fcmToken') // Fetch patient's basic profile & token
        .sort({ appointmentDate: 1, appointmentTime: 1 });   // Upcoming appointments first

        // Formatting data for Flutter/Next.js UI presentation
        const formattedData = appointments.map(app => {
            const mainPatient = app.patients[0]; // Actual patient being treated
            
            return {
                appointmentId: app._id,
                bookingId: app.bookingId,
                patientName: mainPatient?.patientName || app.userId?.name || "Unknown Patient",
                patientAge: mainPatient?.patientAge || "N/A",
                patientGender: mainPatient?.gender || "N/A",
                reasonForVisit: mainPatient?.reasonForVisit || "General Consultation",
                appointmentDate: app.appointmentDate,
                appointmentTime: app.appointmentTime,
                status: app.status,
                totalAmount: app.totalAmount,
                
                // Account holder details
                userAccount: {
                    phone: app.userId?.phone,
                    profilePic: app.userId?.profilePic || null,
                    hasFcmToken: !!app.userId?.fcmToken
                },

                // UI Helper: Frontend can directly use this boolean to enable/disable the "Start Video Call" button
                isCallActionEnabled: true 
            };
        });

        res.json({
            success: true,
            count: formattedData.length,
            data: formattedData
        });

    } catch (error) {
        console.error("Error in getDoctorVideoConsults:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 🚨 NEW: Search Master Medicine Database from Independent Doctor Panel
 * Endpoint: GET /doctor/appointments/medicines/search?query=dolo&page=1
 */
const searchMasterMedicinesForDoctor = async (req, res) => {
    try {
        const { query, page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let filter = {};
        if (query) {
            const regex = new RegExp(query, 'i');
            filter = {
                $or: [
                    { name: regex },
                    { salt_composition: regex },
                    { manufacturers: regex }
                ]
            };
        }

        // Fetching required medicine metadata for prescriptions
        const medicines = await Medicine.find(filter)
            .select('name manufacturers salt_composition packaging mrp image_url')
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ name: 1 });

        const total = await Medicine.countDocuments(filter);

        res.json({
            success: true,
            total,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            data: medicines
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const reportDoctorNoShow = async (req, res) => {
    try {
        // 🚀 SYNC FIX: Reads ID from URL params (req.params.id) directly as requested by Axios
        const appointmentId = req.params.id || req.body.appointmentId; 
        const comments = req.body.comments || req.body.reason || "Patient did not show up for consultation.";

        const doctorId = req.user.id;

        const appointment = await Appointment.findOne({ 
            _id: appointmentId, 
            doctorId, 
            bookingType: 'Appointment',
            status: { $in: ['Confirmed', 'Pending'] } 
        });

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Active scheduled booking record not found." });
        }

        // Fetch remaining cancellation & reschedule limits
        const globalConfig = await DocReschleduleLimit.findOne() || { maxLimit: 2 };
        const maxLimit = globalConfig.maxLimit || 2;

        const remainingCancellations = Math.max(0, maxLimit - (appointment.cancellationCount || 0));
        const remainingReschedules = Math.max(0, maxLimit - (appointment.rescheduleCount || 0));

        const totalPaid = appointment.totalAmount || 0;
        let noShowFee = 0;

        const config = await NoShowConfig.findOne({ vendorType: 'Doctor', isActive: true });
        if (config && config.chargeValue > 0) {
            noShowFee = config.chargeType === 'Percentage'
                ? Math.round((totalPaid * config.chargeValue) / 100)
                : Math.min(config.chargeValue, totalPaid);
        }

        appointment.status = 'No-Show';
        if (!appointment.tracking) {
            appointment.tracking = { otp: null, isOtpVerified: false, noShowReason: "" };
        }
        appointment.tracking.noShowReason = comments;
        appointment.pricingBreakdown.noShowFeeApplied = noShowFee;
        appointment.paymentStatus = noShowFee > 0 ? 'Refund-Initiated' : 'Refunded';

        await appointment.save();

        res.json({ 
            success: true, 
            message: "Consultation No-Show logged successfully.", 
            noShowFeeApplied: noShowFee,
            limits: {
                remainingCancellations,
                remainingReschedules,
                maxLimit
            },
            data: appointment
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 1. SEND APPOINTMENT COMPLETION OTP (NEW API) ---
// Endpoint: POST /doctor/appointments/send-completion-otp
const sendCompletionOtp = async (req, res) => {
    try {
        const { appointmentId } = req.body;
        const doctorId = req.user.id;

        const appointment = await Appointment.findOne({ _id: appointmentId, doctorId, bookingType: 'Appointment' });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Active consultation booking not found." });
        }

        // Generate dynamic 4-digit verification OTP
        let otp;
        let isProduction = process.env.NODE_ENV === 'production';
        if (isProduction) {
            otp = Math.floor(1000 + Math.random() * 9000).toString();
        } else {
            otp = "1111"; // Sandbox master code
        }

        appointment.tracking.otp = otp;
        appointment.tracking.isOtpVerified = false;
        await appointment.save();

        console.log(`[Verification OTP] Appointment: ${appointmentId} | OTP: ${otp}`);

        // Trigger push notification to user containing the verification code
        const { sendPushNotification } = require('../../utils/notification');
        await sendPushNotification(
            appointment.userId,
            'user',
            "🔑 Consultation Completion OTP",
            `Your completion verification code is ${otp}. Please share this with Dr. ${req.user.name} during the call to finalize your prescription.`,
            { appointmentId: appointmentId.toString(), type: 'completion_otp' }
        );

        res.json({ 
            success: true, 
            message: "Verification OTP successfully sent to user.",
            dev_otp: isProduction ? undefined : "1111"
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. VERIFY APPOINTMENT COMPLETION OTP (NEW API) ---
// Endpoint: POST /doctor/appointments/verify-completion-otp
const verifyCompletionOtp = async (req, res) => {
    try {
        const { appointmentId, otp } = req.body;
        const doctorId = req.user.id;

        const appointment = await Appointment.findOne({ _id: appointmentId, doctorId, bookingType: 'Appointment' });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Active consultation booking not found." });
        }

        const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
        const isBypass = isDev && otp === '1111';

        if (!isBypass && String(appointment.tracking?.otp).trim() !== String(otp).trim()) {
            return res.status(400).json({ success: false, message: "Invalid or expired verification OTP. Please try again." });
        }

        appointment.tracking.isOtpVerified = true;
        await appointment.save();

        res.json({ 
            success: true, 
            message: "OTP successfully verified! You are now authorized to complete consultation and submit prescription." 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};




module.exports = { getVendorDashboard,
    getDoctorBookings, getTodayBookings, confirmAppointment,
    doctorCancelAppointment, startVisit, completeWithPrescription,
    getDoctorStats, getMyConsultationFees, updateConsultationFees, rescheduleAppointment,getAllPrescriptions,
    getPrescriptionDetails, updatePrescription, resendPrescription,getAppointmentClinicalDetails, createPrescription,
    getPatientHistory, getPatientHistoryDetails,
    getDoctorVideoConsults,
    searchMasterMedicinesForDoctor,
    reportDoctorNoShow,sendCompletionOtp,verifyCompletionOtp

};