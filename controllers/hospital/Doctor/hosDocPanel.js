// controllers/hospital/Doctor/hosDocPanel.js

const Doctor = require('../../../models/Doctor');
const Appointment = require('../../../models/Appointment');
const Specialization = require('../../../models/Specialization');
const Prescription = require('../../../models/Prescription');
const Availability = require('../../../models/Availability'); 
const Coupon = require('../../../models/Coupon'); 
const DeliveryCharge = require('../../../models/DeliveryCharge'); 
const { generateTimeSlots } = require('../../../utils/timeSlotHelper');
const { getDistance } = require('../../../utils/helpers');
const moment = require('moment');
const crypto = require('crypto');
const Bed = require('../../../models/Bed');
const Ward = require('../../../models/Ward'); 
const Medicine = require('../../../models/Medicine'); // 👈 ADD THIS AT THE TOP OF IMPORTS
const { sendPushNotification } = require('../../../utils/notification');
const { deleteFile } = require('../../../utils/fileHandler'); // Import the deleteFile utility
const ProfileUpdateRequest = require('../../../models/ProfileUpdateRequest');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');


// --- ENRICH APPOINTMENT WITH DYNAMIC 24-HOUR LEDGER SNAPSHOT (For Doctor Panel) ---
const enrichAppointmentClinicalDetails = async (appt, targetDischargeDate = new Date()) => {
    const apptObj = appt.toObject ? appt.toObject() : { ...appt };

    const prescriptionObj = await Prescription.findOne({ appointmentId: apptObj._id })
        .select('pdfUrl dietPlanPdf medicines diagnosis')
        .lean();

    const clinicalFiles = {
        dietPlanPdf: prescriptionObj?.dietPlanPdf || null,
        dischargeSummaryPdf: apptObj.clinicalSummary?.dischargeSummaryPdf || null,
        clinicalReports: apptObj.clinicalSummary?.uploadedReports || [],
        dischargeCardUrl: prescriptionObj?.pdfUrl || null
    };

    const treatmentTeamTimeline = [];

    if (apptObj.doctorId) {
        const primaryShift = apptObj.treatmentHistory?.find(h => 
            h.toDoctorId && h.toDoctorId._id?.toString() === apptObj.doctorId._id?.toString() && h.startTime
        );

        treatmentTeamTimeline.push({
            doctorId: apptObj.doctorId._id,
            name: apptObj.doctorId.name,
            speciality: apptObj.doctorId.speciality,
            qualification: apptObj.doctorId.qualification || "MD",
            profileImage: apptObj.doctorId.profileImage,
            role: "Primary Physician",
            joinedAt: primaryShift ? primaryShift.startTime : apptObj.startDate,
            dischargedAt: primaryShift?.endTime || apptObj.endDate || null,
            duration: primaryShift?.durationDisplay || ""
        });
    }

    if (apptObj.bedsideCareTeam && apptObj.bedsideCareTeam.length > 0) {
        apptObj.bedsideCareTeam.forEach(member => {
            if (member.doctorId) {
                treatmentTeamTimeline.push({
                    doctorId: member.doctorId._id,
                    name: member.doctorId.name,
                    speciality: member.doctorId.speciality,
                    qualification: member.doctorId.qualification || "MD",
                    profileImage: member.doctorId.profileImage,
                    role: "Bedside Specialist",
                    joinedAt: member.startTime || member.requestedAt,
                    dischargedAt: member.endTime || member.respondedAt || null,
                    duration: member.durationDisplay || ""
                });
            }
        });
    }

    // 🚀 24-Hour Stay Calculations
    const bedPricePerDay = apptObj.bedId?.pricePerDay || 500;
    const checkIn = moment(apptObj.startDate || apptObj.createdAt);
    const checkOut = moment(targetDischargeDate);
    const diffMs = Math.max(0, checkOut.diff(checkIn));
    const exactHours = Number((diffMs / (1000 * 60 * 60)).toFixed(1));
    const actualStayDays = Math.max(1, Math.ceil(exactHours / 24));
    
    let bookedDays = apptObj.stayDuration || 1;
    if (apptObj.startDate && apptObj.endDate) {
        const startDay = moment(apptObj.startDate).startOf('day');
        const endDay = moment(apptObj.endDate).startOf('day');
        bookedDays = Math.max(1, endDay.diff(startDay, 'days') + 1);
    }
    
    const actualStayBedCharge = actualStayDays * bedPricePerDay;
    
    let depositPaidOnBooking = 0;
    if (apptObj.paymentStatus === 'Paid' || apptObj.paymentDetails?.status === 'captured') {
        depositPaidOnBooking = Number(apptObj.paymentDetails?.amount || apptObj.totalAmount || (bookedDays * bedPricePerDay));
    }
    
    let unusedDays = 0;
    let unusedDaysRefund = 0;
    let overstayDays = 0;
    let overstayCharge = 0;
    
    if (actualStayDays < bookedDays) {
        unusedDays = bookedDays - actualStayDays;
        unusedDaysRefund = unusedDays * bedPricePerDay;
    } else if (actualStayDays > bookedDays) {
        overstayDays = actualStayDays - bookedDays;
        overstayCharge = overstayDays * bedPricePerDay;
    }
    
    const extraServicesTotal = (apptObj.specialServices || [])
        .filter(s => !s.serviceName?.startsWith("Overstay Bed Surcharge"))
        .reduce((sum, item) => sum + (Number(item.price) || 0), 0);
        
    const discount = Number(apptObj.pricingBreakdown?.discountAmount || apptObj.couponDetails?.discountValue || 0);
    const totalActualBill = Math.max(0, actualStayBedCharge + extraServicesTotal - discount);
    const netBalance = totalActualBill - depositPaidOnBooking;
    
    let refundDueToUser = 0;
    let pendingDepartureBalance = 0;
    let settlementStatus = "Settled";
    
    if (netBalance < 0) {
        refundDueToUser = Math.abs(netBalance);
        pendingDepartureBalance = 0;
        settlementStatus = "Refund-Initiated";
    } else if (netBalance > 0) {
        pendingDepartureBalance = netBalance;
        refundDueToUser = 0;
        settlementStatus = "Pending-Collection";
    }

    const billingBreakdown = {
        stayUnitCharge: bedPricePerDay,
        baseStayDuration: `${actualStayDays} Day${actualStayDays > 1 ? 's' : ''} (${exactHours} Hours)`,
        actualStayDays,
        exactStayHours: exactHours,
        bookedDays,
        accumulatedBaseFee: actualStayBedCharge,
        depositPaidOnBooking,
        unusedDays,
        unusedDaysRefund,
        overstayDays,
        overstayCharge,
        extraFacilitiesFee: extraServicesTotal,
        discountDeductions: discount,
        totalInvoiceValue: totalActualBill,
        currentBillTotal: totalActualBill,
        refundDueToUser,
        pendingDepartureBalance,
        settlementStatus
    };

    return {
        ...apptObj,
        clinicalFiles,
        treatmentTeamTimeline,
        billingBreakdown
    };
};

// 🛡️ REUSABLE DTO HELPER: Resolves accurate single patient profile & bloodGroup for Hospital Doctor
const resolvePatientDTO = (appt) => {
    const user = appt.userId;
    const primaryPatient = appt.patients?.[0] || {};
    const isSelf = !primaryPatient.relation || 
                   primaryPatient.relation.toLowerCase() === 'self' || 
                   (user?.name && primaryPatient.patientName && primaryPatient.patientName.trim().toLowerCase() === user.name.trim().toLowerCase());

    let matchedFamilyMember = null;
    if (!isSelf && user?.familyMember && Array.isArray(user.familyMember)) {
        matchedFamilyMember = user.familyMember.find(fm => 
            (fm.memberName && primaryPatient.patientName && fm.memberName.trim().toLowerCase() === primaryPatient.patientName.trim().toLowerCase()) ||
            (fm.relation && primaryPatient.relation && fm.relation.trim().toLowerCase() === primaryPatient.relation.trim().toLowerCase())
        );
    }

    let resolvedBloodGroup = "N/A";
    if (appt.clinicalSummary?.bloodGroup && appt.clinicalSummary.bloodGroup.trim() !== "") {
        resolvedBloodGroup = appt.clinicalSummary.bloodGroup;
    } else if (primaryPatient.bloodGroup && primaryPatient.bloodGroup.trim() !== "") {
        resolvedBloodGroup = primaryPatient.bloodGroup;
    } else if (!isSelf && matchedFamilyMember?.bloodGroup) {
        resolvedBloodGroup = matchedFamilyMember.bloodGroup;
    } else if (isSelf && user?.bloodGroup) {
        resolvedBloodGroup = user.bloodGroup;
    }

    const resolvedProfilePic = (!isSelf && matchedFamilyMember?.profilePic) 
        ? matchedFamilyMember.profilePic 
        : (user?.profilePic || null);

    const resolvedAge = primaryPatient.patientAge || 
        (matchedFamilyMember?.dob ? moment().diff(moment(matchedFamilyMember.dob), 'years') : (user?.age || "N/A"));

    return {
        patientName: primaryPatient.patientName || (isSelf ? user?.name : "Admitted Patient"),
        age: resolvedAge,
        gender: primaryPatient.gender || matchedFamilyMember?.gender || (isSelf ? user?.gender : "N/A"),
        relation: matchedFamilyMember?.relation || primaryPatient.relation || (isSelf ? "Self" : "Family Member"),
        bloodGroup: resolvedBloodGroup, // 👈 Single, accurate Blood Group!
        reasonForVisit: primaryPatient.reasonForVisit || appt.bookingReason || "Hospital Admission",
        profilePic: resolvedProfilePic
    };
};


// --- 11. GET MY DOCTOR PROFILE DETAILS (GET API) ---
const getMyDoctorProfile = async (req, res) => {
    try {
        const doctor = await Doctor.findById(req.user.id)
            .populate('hospitalId', 'name address city state hospitalImage')
            .select('-password');
        
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor profile not found." });
        }

        res.json({ success: true, data: doctor });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// PATCH: Change Hospital Doctor Password
// Endpoint: PATCH /hospital-doctor/panel/profile/change-password
const changeHospitalDoctorPassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ success: false, message: "Old password and new password are required." });
        }

        const doctor = await Doctor.findById(req.user.id).select('+password');
        if (!doctor) return res.status(404).json({ success: false, message: "Doctor not found." });

        const isMatch = await bcrypt.compare(String(oldPassword), doctor.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Old password does not match." });
        }

        doctor.password = await bcrypt.hash(String(newPassword), 10);
        await doctor.save();

        res.json({ success: true, message: "Hospital doctor password updated successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 12. UPDATE MY DOCTOR PROFILE (Staged Update & Staging Cleanup) ---
const updateDoctorProfile = async (req, res) => {
    try {
        const doctorId = req.user.id;
       
        // Fetch current profile to handle existing validation checks
        const existingDoc = await Doctor.findById(doctorId);
        if (!existingDoc) {
            return res.status(404).json({ success: false, message: 'Doctor not found' });
        }

        // Allowed professional fields for self-update (Excludes role, email, phone, documents, password, profileStatus)
        const {
            name, country, state, city, address,
            qualification, speciality, about, experienceYears,
            languages, fees, consultationStatus,
            alternatePhone,

            // 🚨 NEW FLAT FIELDS TO BYPASS WAF CODE-INJECTION BLOCKS:
            fees_online, fees_clinic, fees_home,
            consultationStatus_online, consultationStatus_clinic, consultationStatus_home
        } = req.body;
 
        const updates = {};
        if (name) updates.name = name;
        if (country) updates.country = country;
        if (state) updates.state = state;
        if (city) updates.city = city;
        if (address) updates.address = address;
        if (qualification) updates.qualification = qualification;
        if (speciality) updates.speciality = speciality;
        if (about) updates.about = about;
        if (experienceYears) updates.experienceYears = Number(experienceYears);
        if (alternatePhone) updates.alternatePhone = alternatePhone; 
       
        // Handle languages array parsing safely
        if (languages) {
            updates.languages = Array.isArray(languages) ? languages : JSON.parse(languages);
        }
       
        // --- 🚨 SECURE WAF BYPASS: ASSEMBLE FEES OBJECT FROM FLAT FIELDS ---
        if (fees_online !== undefined || fees_clinic !== undefined || fees_home !== undefined) {
            updates.fees = {
                online: fees_online !== undefined ? Number(fees_online) : (existingDoc.fees?.online || 0),
                clinic: fees_clinic !== undefined ? Number(fees_clinic) : (existingDoc.fees?.clinic || 0),
                home: fees_home !== undefined ? Number(fees_home) : (existingDoc.fees?.home || 0)
            };
        } else if (fees) {
            // Fallback for Postman / raw JSON strings
            updates.fees = typeof fees === 'string' ? JSON.parse(fees) : fees;
        }
       
        // --- 🚨 SECURE WAF BYPASS: ASSEMBLE CONSULTATION STATUS FROM FLAT FIELDS ---
        if (consultationStatus_online !== undefined || consultationStatus_clinic !== undefined || consultationStatus_home !== undefined) {
            updates.consultationStatus = {
                online: consultationStatus_online !== undefined ? (consultationStatus_online === 'true' || consultationStatus_online === true) : (existingDoc.consultationStatus?.online ?? true),
                clinic: consultationStatus_clinic !== undefined ? (consultationStatus_clinic === 'true' || consultationStatus_clinic === true) : (existingDoc.consultationStatus?.clinic ?? true),
                home: consultationStatus_home !== undefined ? (consultationStatus_home === 'true' || consultationStatus_home === true) : (existingDoc.consultationStatus?.home ?? true)
            };
        } else if (consultationStatus) {
            // Fallback for Postman / raw JSON strings
            updates.consultationStatus = typeof consultationStatus === 'string' ? JSON.parse(consultationStatus) : consultationStatus;
        }
 
        // Process new file uploads
        if (req.files && req.files.profileImage && req.files.profileImage[0]) {
            updates.profileImage = `/uploads/doctors/${req.files.profileImage[0].filename}`;
        }

        if (req.files && req.files.signatureImage && req.files.signatureImage[0]) {
            updates.signatureImage = `/uploads/doctors/${req.files.signatureImage[0].filename}`;
        }

        // DISK CLEANUP: Delete unapproved files from any existing PENDING update request
        const existingPending = await ProfileUpdateRequest.findOne({ 
            vendorId: doctorId, 
            vendorModel: 'Doctor', 
            status: 'Pending' 
        });

        if (existingPending) {
            if (updates.profileImage && existingPending.updatedFields?.profileImage) {
                deleteFile(existingPending.updatedFields.profileImage);
            }
            if (updates.signatureImage && existingPending.updatedFields?.signatureImage) {
                deleteFile(existingPending.updatedFields.signatureImage);
            }
            await ProfileUpdateRequest.findByIdAndDelete(existingPending._id);
        }

        // Save staged changes to the approval collection
        const request = await ProfileUpdateRequest.create({
            vendorId: doctorId,
            vendorModel: 'Doctor',
            updatedFields: updates,
            status: 'Pending'
        });
 
        res.json({
            success: true,
            message: "Profile changes submitted to Admin for review. Your profile will update once approved.",
            data: request
        });
 
    } catch (error) {
        console.error("Profile update error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 18. GET LATEST PROFILE REQUEST STATUS ---
const getLatestDoctorProfileRequest = async (req, res) => {
    try {
        const latestRequest = await ProfileUpdateRequest.findOne({
            vendorId: req.user.id,
            vendorModel: 'Doctor'
        })
        .sort({ createdAt: -1 })
        .lean();

        res.json({ success: true, data: latestRequest || null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// Helper to calculate human readable duration display
const calculateDurationDisplay = (start, end) => {
    if (!start || !end) return "";
    const s = moment(start);
    const e = moment(end);
    const diffMs = e.diff(s);
    const duration = moment.duration(diffMs);
    
    const hours = Math.floor(duration.asHours());
    const minutes = duration.minutes();
    
    if (hours > 0) {
        return `${hours} hr ${minutes} mins`;
    }
    return `${minutes} mins`;
};

// 1. GET ALL SPECIALIZATIONS
const getSpecializations = async (req, res) => {
    try {
        const list = await Specialization.find({ isActive: true });
        res.json({ success: true, data: list });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get Hospital Doctor Dashboard Overview (Counts Live OPD Tokens, IPD Admissions & Emergency)
// @route   GET /hospital-doctor/panel/dashboard
// @access  Private (Hospital Doctor)
const getDocDashboard = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const doctor = req.user;

        const todayStart = moment().startOf('day').toDate();
        const todayEnd = moment().endOf('day').toDate();

        // 1. Fetch Today's OPD Counters
        const [opdTotal, opdCompleted, activeOpdConsulting, ipdAdmissions, emergencyCases, pendingTransfers] = await Promise.all([
            // Today's total scheduled OPD patients
            Appointment.countDocuments({
                doctorId,
                bookingType: 'OPD',
                appointmentDate: { $gte: todayStart, $lte: todayEnd },
                status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital'] }
            }),
            // Today's finished OPD consultations
            Appointment.countDocuments({
                doctorId,
                bookingType: 'OPD',
                appointmentDate: { $gte: todayStart, $lte: todayEnd },
                status: 'Completed'
            }),
            // Current in-progress consultation in cabin
            Appointment.findOne({
                doctorId,
                bookingType: 'OPD',
                appointmentDate: { $gte: todayStart, $lte: todayEnd },
                status: 'In-Progress'
            }).select('tokenNumber bookingId patients').lean(),
            // Active IPD Bed admissions under this doctor
            Appointment.countDocuments({
                doctorId,
                bookingType: 'Admission',
                status: { $in: ['Confirmed', 'In-Progress'] }
            }),
            // Critical Emergency triage cases
            Appointment.countDocuments({
                doctorId,
                triageLevel: 'Emergency',
                status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] }
            }),
            // Pending handovers
            Appointment.countDocuments({
                pendingDoctorId: doctorId,
                status: { $nin: ['Completed', 'Cancelled-By-User'] }
            })
        ]);

        const opdPending = Math.max(0, opdTotal - opdCompleted);
        const currentToken = activeOpdConsulting ? activeOpdConsulting.tokenNumber : (opdCompleted + 1);

        res.status(200).json({
            success: true,
            welcomeName: doctor.name,
            speciality: doctor.speciality,
            dutyStatus: doctor.dutyStatus || "On Duty",
            opdRoomNumber: doctor.department?.roomNumber || "Cabin 1",
            opdFee: Number(doctor.fees?.clinic || 500),
            stats: {
                // OPD Counters
                todayOpdTotal: opdTotal,
                todayOpdCompleted: opdCompleted,
                todayOpdPending: opdPending,
                currentServingToken: opdTotal > 0 ? currentToken : null,
                currentlyConsultingPatient: activeOpdConsulting ? {
                    bookingId: activeOpdConsulting.bookingId,
                    tokenNumber: activeOpdConsulting.tokenNumber,
                    patientName: activeOpdConsulting.patients?.[0]?.patientName || "Patient"
                } : null,
                // IPD & Emergency Counters
                activeIpdAdmissions: ipdAdmissions,
                emergencyCases,
                pendingTransfers
            }
        });

    } catch (error) {
        console.error("Get Hospital Doctor Dashboard Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};





// @desc    Doctor Adds Prescription & Submits Digital Rx (Persists Follow-Up Date & Completes OPD Visit)
// @route   POST /hospital-doctor/panel/prescription/add
// @access  Private (Hospital Doctor)
const processPrescription = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { 
            appointmentId, 
            diagnosis, 
            medicines, 
            advice, 
            vitals, 
            advisedInvestigations, 
            nextAppointment,        // 👈 Captured follow-up visit date/string
            specialInstructions 
        } = req.body;

        if (!appointmentId) {
            return res.status(400).json({ success: false, message: "appointmentId is required." });
        }

        const appointment = await Appointment.findById(appointmentId).populate('userId', 'name phone fcmToken');
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment record not found." });
        }

        const safeArrayParse = (val) => {
            if (!val) return [];
            if (Array.isArray(val)) return val;
            try { return JSON.parse(val); } catch (e) { return []; }
        };

        const parsedMedicines = safeArrayParse(medicines);
        const parsedDiagnosis = Array.isArray(diagnosis) ? diagnosis : (typeof diagnosis === 'string' ? diagnosis.split(',').map(d => d.trim()) : []);

        let prescriptionPdfUrl = null;
        if (req.files && req.files['prescriptionPdf'] && req.files['prescriptionPdf'][0]) {
            prescriptionPdfUrl = `/uploads/doctor_prescriptions/${req.files['prescriptionPdf'][0].filename}`;
        }

        let dietPlanPdfUrl = null;
        if (req.files && req.files['dietPlanPdf'] && req.files['dietPlanPdf'][0]) {
            dietPlanPdfUrl = `/uploads/diet_plans/${req.files['dietPlanPdf'][0].filename}`;
        }

        const newPrescription = await Prescription.create({
            appointmentId: appointment._id,
            doctorId,
            userId: appointment.userId._id,
            diagnosis: parsedDiagnosis,
            medicines: parsedMedicines,
            adviceGiven: advice || "",
            vitals: vitals || {},
            advisedInvestigations: advisedInvestigations || "None",
            nextAppointment: nextAppointment ? String(nextAppointment).trim() : "", // 👈 Persisted follow-up date
            specialInstructions: specialInstructions || "",
            pdfUrl: prescriptionPdfUrl,
            dietPlanPdf: dietPlanPdfUrl
        });

        // If OPD, writing prescription completes the consultation visit
        if (appointment.bookingType === 'OPD') {
            appointment.status = 'Completed';
            if (appointment.paymentMethod === 'COD') {
                appointment.paymentStatus = 'Paid';
            }
            appointment.clinicalSummary = {
                ...appointment.clinicalSummary,
                diagnosis: parsedDiagnosis.join(', '),
                dischargeNote: advice || "OPD consultation completed.",
                dischargedAt: new Date()
            };
        }

        await appointment.save();

        // Push Alert to Patient that Digital Rx is Ready
        if (appointment.userId) {
            try {
                await sendPushNotification(
                    appointment.userId._id,
                    'user',
                    "Digital Prescription Ready! 📄",
                    `Dr. ${req.user.name || 'Doctor'} has issued your digital prescription for consultation #${appointment.bookingId}.`,
                    { appointmentId: appointment._id.toString(), prescriptionId: newPrescription._id.toString(), type: 'prescription_issued' }
                );
            } catch (e) {}
        }

        res.status(200).json({
            success: true,
            message: appointment.bookingType === 'OPD' 
                ? "Prescription saved and OPD consultation marked as Completed!"
                : "Prescription added successfully to in-patient records.",
            bookingStatus: appointment.status,
            data: newPrescription
        });

    } catch (error) {
        console.error("Process Prescription Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. TRANSFER PATIENT HANDOVER (Doctor A Panel)
// Updated: Automatically sets the transferring doctor's shift action to 'Discharged' upon initiating transfer
const transferPatient = async (req, res) => {
    try {
        const { appointmentId, toDoctorId, reason, priority } = req.body;

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) return res.status(404).json({ success: false, message: "Case not found" });

        // Verify target colleague
        const targetDoctor = await Doctor.findOne({ 
            _id: toDoctorId, 
            hospitalId: req.user.hospitalId, 
            role: 'hospital-doctor',
            isActive: true 
        });

        if (!targetDoctor) {
            return res.status(400).json({ success: false, message: "Target doctor not active in this hospital." });
        }

        const now = new Date();

        // 1. Close Doctor A's (current doctor) active shift in history and mark as 'Discharged'
        const activeShift = appointment.treatmentHistory.find(h => 
            h.toDoctorId && h.toDoctorId.toString() === req.user.id && !h.endTime
        );
        if (activeShift) {
            activeShift.endTime = now;
            activeShift.action = 'Discharged'; // 🚀 SYNC FIX: Officially discharges Doctor A from active care duty
            activeShift.durationDisplay = calculateDurationDisplay(activeShift.startTime, now);
        }

        // 2. Set Pending status & targets
        appointment.pendingDoctorId = toDoctorId;
        appointment.triageLevel = priority || appointment.triageLevel;
        
        // 3. Push Transfer-Initiated log
        appointment.treatmentHistory.push({
            fromDoctorId: req.user.id,
            toDoctorId: toDoctorId,
            action: 'Transfer-Initiated',
            notes: reason || "Shift Handover",
            timestamp: now
        });

        await appointment.save();
        res.json({ success: true, message: "Patient handover initiated. Pending colleague acceptance." });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// 3. ACCEPT PATIENT HANDOVER (Doctor B Panel - NEW API)
const acceptTransfer = async (req, res) => {
    try {
        const { appointmentId } = req.body;

        const appointment = await Appointment.findOne({ _id: appointmentId, pendingDoctorId: req.user.id });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "No pending transfer request found." });
        }

        const oldDoctorId = appointment.doctorId;
        const now = new Date();

        // Make Doctor B primary
        appointment.doctorId = req.user.id;
        appointment.pendingDoctorId = null;
        appointment.status = 'In-Progress';

        // 1. Push Acceptance audit and START Doctor B's shift
        appointment.treatmentHistory.push({
            fromDoctorId: oldDoctorId,
            toDoctorId: req.user.id,
            action: 'Transfer-Accepted',
            notes: "Handover accepted on duty.",
            timestamp: now,
            startTime: now // 👈 Start of Doctor B's treatment shift
        });

        await appointment.save();
        res.json({ success: true, message: "Transfer accepted. Patient added to your active tray.", data: appointment });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// --- 16. REJECT/DECLINE PATIENT HANDOVER (Doctor B Action - NEW API) ---
// Updated: Re-activates/re-opens a new active treatment shift for Doctor A if Doctor B declines handover
const rejectTransfer = async (req, res) => {
    try {
        const { appointmentId, reason } = req.body;
        const doctorId = req.user.id; // Doctor B (Who is rejecting)

        const appointment = await Appointment.findOne({ 
            _id: appointmentId, 
            pendingDoctorId: doctorId 
        });

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Handover request not found or already processed." });
        }

        const senderDoctorId = appointment.doctorId; // Doctor A (Original sender)
        const now = new Date();

        // 1. Clear pending transfer state (Patient goes back to Doctor A's active queue instantly)
        appointment.pendingDoctorId = null;
        
        // 2. Push rejection log to timeline history securely
        appointment.treatmentHistory.push({
            fromDoctorId: doctorId, // Doctor B
            toDoctorId: senderDoctorId, // Doctor A
            action: 'Transfer-Initiated', 
            notes: `Transfer Rejected by Dr. ${req.user.name}. Reason: ${reason || 'Shift duty mismatch'}`,
            timestamp: now
        });

        // 🚀 SYNC FIX: Re-open a new active treatment shift for Doctor A (senderDoctorId) so they can continue tracking stay duration
        appointment.treatmentHistory.push({
            toDoctorId: senderDoctorId,
            action: 'Transfer-Accepted', // Re-activated under Doctor A
            notes: `Case returned to duty of previous physician after transfer rejection.`,
            timestamp: now,
            startTime: now // Start new active shift tracking for Doctor A
        });

        await appointment.save();
        res.json({ success: true, message: "Handover transfer declined successfully. Case returned to sender." });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 6. GET COLLEAGUES (Fixed Privacy data leak) ---
const getHospitalColleagues = async (req, res) => {
    try {
        // FIX: Prevent null/undefined matching leaks for independent doctors
        if (!req.user.hospitalId) {
            return res.status(400).json({ 
                success: false, 
                message: "Unauthorized: Aap kisi hospital se associated nahi hain." 
            });
        }

        const doctors = await Doctor.find({ 
            hospitalId: req.user.hospitalId, 
            _id: { $ne: req.user.id }, // Self excluded
            role: 'hospital-doctor',   // Only hospital associated colleagues
            isActive: true 
        }).select('name speciality profileImage dutyStatus');

        res.json({ success: true, data: doctors });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 7. DISCHARGE SUMMARY (Updated with safe atomic $set and Multiple file uploads) ---
// Endpoint: POST /hospital-doctor/panel/case/discharge-summary
const submitDischargeSummary = async (req, res) => {
    try {
        const body = req.body || {};
        const appointmentId = body.appointmentId || req.query.appointmentId;

        if (!appointmentId) {
            return res.status(400).json({ 
                success: false, 
                message: "Validation Error: 'appointmentId' is required." 
            });
        }

        const now = new Date();
        const appointmentObj = await Appointment.findById(appointmentId);
        if (!appointmentObj) {
            return res.status(404).json({ success: false, message: "Patient Admission Record Not Found." });
        }

        // Close Active Doctor's shift directly on document
        if (appointmentObj.treatmentHistory && appointmentObj.treatmentHistory.length > 0) {
            const activeShift = appointmentObj.treatmentHistory.find(h => 
                h.toDoctorId && h.toDoctorId.toString() === req.user.id.toString() && !h.endTime
            );
            if (activeShift) {
                activeShift.endTime = now;
                activeShift.durationDisplay = calculateDurationDisplay(activeShift.startTime, now);
            }
        }

        // Auto-close bedside specialist consults
        if (appointmentObj.bedsideCareTeam && appointmentObj.bedsideCareTeam.length > 0) {
            appointmentObj.bedsideCareTeam.forEach(member => {
                if (['Pending', 'Accepted', 'In-Progress'].includes(member.status)) {
                    member.status = member.status === 'Pending' ? 'Rejected' : 'Completed';
                    member.endTime = member.endTime || now;
                    member.respondedAt = member.respondedAt || now;
                    if (member.startTime) {
                        member.durationDisplay = calculateDurationDisplay(member.startTime, now);
                    }
                }
            });
        }

        // Extract uploaded additional reports
        let updatedReports = appointmentObj.clinicalSummary?.uploadedReports || [];
        if (req.files && req.files.clinicalReports) {
            const reportPaths = req.files.clinicalReports.map(f => `/uploads/doctor_reports/${f.filename}`);
            updatedReports = [...updatedReports, ...reportPaths];
        }

        // Extract final generated Discharge PDF path
        let dischargePdfPath = appointmentObj.clinicalSummary?.dischargeSummaryPdf || null;
        if (req.files && req.files.dischargePdf && req.files.dischargePdf[0]) {
            dischargePdfPath = `/uploads/hospital_discharges/${req.files.dischargePdf[0].filename}`;
        }

        // Parse final discharge vitals
        let parsedVitals = { bp: "", pulse: "", temp: "", spo2: "" };
        if (body.vitals) {
            parsedVitals = typeof body.vitals === 'string' ? JSON.parse(body.vitals) : body.vitals;
        } else {
            parsedVitals = {
                bp: body.bp || "",
                pulse: body.pulse || "",
                temp: body.temp || "",
                spo2: body.spo2 || ""
            };
        }

        // 🛡️ CRASH FIX: Safe Date Parsing for dateOfSurgery
        let parsedSurgeryDate = appointmentObj.clinicalSummary?.dateOfSurgery || null;
        if (body.dateOfSurgery && body.dateOfSurgery !== 'undefined' && body.dateOfSurgery !== 'null' && String(body.dateOfSurgery).trim() !== '') {
            const d = new Date(body.dateOfSurgery);
            if (!isNaN(d.getTime())) {
                parsedSurgeryDate = d;
            }
        }

        appointmentObj.status = 'Discharge-Pending';
        appointmentObj.clinicalSummary = {
            diagnosis: body.diagnosis || appointmentObj.clinicalSummary?.diagnosis || "",
            investigation: body.investigation || appointmentObj.clinicalSummary?.investigation || "",
            treatmentResult: body.treatmentResult || appointmentObj.clinicalSummary?.treatmentResult || "",
            dischargeNote: body.dischargeNote || appointmentObj.clinicalSummary?.dischargeNote || "",
            dischargedAt: now,
            uploadedReports: updatedReports,
            dateOfSurgery: parsedSurgeryDate,
            conditionDuringAdmission: body.conditionDuringAdmission || appointmentObj.clinicalSummary?.conditionDuringAdmission || "",
            conditionDuringDischarge: body.conditionDuringDischarge || appointmentObj.clinicalSummary?.conditionDuringDischarge || "",
            dischargeSummaryPdf: dischargePdfPath,
            vitals: parsedVitals
        };

        appointmentObj.treatmentHistory.push({
            fromDoctorId: req.user.id,
            action: 'Discharged',
            notes: "Clinical discharge summary and medical reports submitted by duty physician.",
            timestamp: now
        });

        appointmentObj.markModified('treatmentHistory');
        appointmentObj.markModified('bedsideCareTeam');
        await appointmentObj.save();

        res.json({ 
            success: true, 
            message: "Discharge summary, clinical files, and final PDF summary recorded successfully.", 
            data: appointmentObj 
        });

    } catch (error) { 
        console.error("Discharge summary error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// GET: Public QR Code verification endpoint (No Auth Required)
// --- 17. PUBLIC QR CODE DISCHARGE VERIFICATION (No Auth Required) ---
const verifyDischargeSheet = async (req, res) => {
    try {
        const { id } = req.params; // Appointment/Admission ID

        // Query the admission record with limited details for public validation
        const appt = await Appointment.findById(id)
            .populate('hospitalId', 'name address city state')
            .populate('doctorId', 'name speciality qualification');

        if (!appt) {
            return res.status(404).json({ 
                success: false, 
                message: "Verification Failed: Invalid or expired discharge document." 
            });
        }

        // Fetch corresponding prescription medications
        const prescription = await Prescription.findOne({ appointmentId: id }).sort({ createdAt: -1 });

        // Build the structured dataset to populate the printable template
        const dynamicHandoffDoctors = appt.bedsideCareTeam
            .filter(member => ['Completed', 'Accepted', 'In-Progress'].includes(member.status))
            .map(member => ({
                name: member.doctorId?.name || "Specialist",
                department: `Department of ${member.doctorId?.speciality || 'Medicine'}`
            }));

        // Helper to format payment method
        const formatPaymentMethod = (method) => {
            if (!method) return "Pending";
            if (method.toUpperCase() === 'ONLINE' || method.toUpperCase() === 'UPI') return "UPI (Google Pay)";
            if (method.toUpperCase() === 'CASH' || method.toUpperCase() === 'COD') return "Cash / Offline";
            return method;
        };

        const verificationData = {
            verifiedStatus: "AUTHENTIC_DOCUMENT",
            verifiedAt: new Date(),
            header: {
                hospitalName: appt.hospitalId?.name || "RADIUS HOSPITAL",
                hospitalAddress: appt.hospitalId?.address || "Mohali, Punjab",
                leadDoctor: {
                    name: appt.doctorId?.name,
                    title: `Department of ${appt.doctorId?.speciality || 'Medicine'}`,
                    qualification: appt.doctorId?.qualification || "MD"
                },
                collaborativeDoctors: dynamicHandoffDoctors
            },
            patientDetails: {
                appointmentId: appt.bookingId,
                name: appt.userId?.name || "Verified Patient",
                gender: appt.userId?.gender || "N/A",
                age: appt.userId?.age || "N/A",
                
                // 1. Date of Admission
                dateOfAdmission: appt.startDate ? moment(appt.startDate).format("YYYY-MM-DD") : "N/A",
                
                // 2. Department
                department: appt.doctorId?.speciality 
                    ? `Department of ${appt.doctorId.speciality}, Unit - 1` 
                    : "Department of Medicine, Unit - 1",
                
                // 3. Date of Discharge
                dateOfDischarge: appt.endDate ? moment(appt.endDate).format("YYYY-MM-DD") : "N/A",
                
                // 4. Date of Surgery (dynamic check)
                dateOfSurgery: appt.clinicalSummary?.dateOfSurgery 
                    ? moment(appt.clinicalSummary.dateOfSurgery).format("YYYY-MM-DD") 
                    : "N/A",
                
                // 5. Insurance Status
                insuranceStatus: appt.hasInsurance ? "Verified (Cashless)" : "N/A",
                
                // 6. Payment Status
                paymentStatus: appt.paymentStatus || "Pending",
                
                // 7. Payment Type
                paymentType: formatPaymentMethod(appt.paymentMethod),
                
                // 8. Condition during Admission
                conditionDuringAdmission: appt.clinicalSummary?.conditionDuringAdmission || "Stable",
                
                // 9. Condition during Discharge
                conditionDuringDischarge: appt.clinicalSummary?.conditionDuringDischarge || "Recovered & Stable",

                chiefComplaints: appt.clinicalSummary?.chiefComplaint || appt.patients?.[0]?.reasonForVisit || "N/A",
                diagnosis: appt.clinicalSummary?.diagnosis || "N/A"
            },
            medications: prescription ? prescription.medicines.map((med, idx) => ({
                sNo: String(idx + 1).padStart(2, '0'),
                medicineName: med.name,
                dose: med.dosage,
                time: med.frequency,
                duration: med.duration
            })) : [],
            followUp: {
                adviseInvestigation: appt.clinicalSummary?.investigation || "ECG Normal, Blood counts stable",
                adviceGiven: appt.clinicalSummary?.dischargeNote || "Avoid excess salt and drink warm water.",
                anySpecialInstructionGiven: "This digital Discharge Document is not valid for Medico Legal purpose."
            }
        };

        res.json({
            success: true,
            data: verificationData
        });

    } catch (error) {
        console.error("Public verification error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- API: UPLOAD & ATTACH PATIENT CLINICAL REPORTS (Independent Multi-upload - NEW API) ---
// Endpoint: POST /hospital-doctor/panel/case/upload-reports/:id
const uploadPatientReports = async (req, res) => {
    try {
        const { id } = req.params; // Appointment/Admission ID

        // 1. Fetch uploaded multiple files paths from multer fields
        // Since we are uploading multiple files, we access them via req.files
        const files = req.files || [];
        
        if (files.length === 0) {
            return res.status(400).json({ success: false, message: "Kripya kam se kam ek report file upload karein (clinicalReports key me)." });
        }

        const reportPaths = files.map(f => `/uploads/doctor_reports/${f.filename}`);

        // 2. Update Appointment using atomic $push and $each to append new reports securely
        // This ensures old reports are NOT overwritten, they are appended to the list!
        const appointment = await Appointment.findByIdAndUpdate(
            id,
            { 
                $push: { "clinicalSummary.uploadedReports": { $each: reportPaths } } 
            },
            { new: true, runValidators: true }
        );

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Patient Admission Record Not Found." });
        }

        res.json({ 
            success: true, 
            message: `${reportPaths.length} Reports uploaded and attached to patient's clinical file successfully.`, 
            data: appointment.clinicalSummary.uploadedReports // Returns complete updated reports array
        });

    } catch (error) {
        console.error("Independent report upload error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 8. DUTY STATUS TOGGLE ---
const updateDutyStatus = async (req, res) => {
    try {
        const { status } = req.body; // 'On Duty', 'Off Duty', 'On Leave', 'Busy'
        
        const doctor = await Doctor.findByIdAndUpdate(
            req.user.id, 
            { dutyStatus: status }, 
            { new: true }
        );

        res.json({ success: true, message: `Status updated to ${status}`, current: doctor.dutyStatus });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 9. GET MEDICINE TEMPLATES
// 9. GET MEDICINE TEMPLATES (Updated: Fetching dynamically from real Medicine Database collection)
const getMedicineList = async (req, res) => {
    try {
        const { search, page = 1, limit = 20 } = req.query; // Paginated and searchable
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let query = {};

        // Case-insensitive regex matching for medicine names in the database
        if (search) {
            query.name = { $regex: search, $options: 'i' };
        }

        // Fetching lightweight fields first to keep API response speed extremely fast
        const medicines = await Medicine.find(query)
            .select('name manufacturers salt_composition mrp best_price prescription_required')
            .sort({ name: 1 }) // Alphabetic sorting
            .skip(skip)
            .limit(parseInt(limit));

        res.json({ 
            success: true, 
            count: medicines.length, 
            data: medicines 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 10. UPDATE ADMISSION CLINICAL SUMMARY
const updateClinicalSummary = async (req, res) => {
    try {
        const { appointmentId, chiefComplaint, triagePriority, admissionNote, bloodGroup } = req.body;

        const update = {
            'clinicalSummary.chiefComplaint': chiefComplaint,
            'clinicalSummary.triagePriority': triagePriority,
            'clinicalSummary.admissionNote': admissionNote,
            'clinicalSummary.bloodGroup': bloodGroup
        };

        const appointment = await Appointment.findByIdAndUpdate(appointmentId, { $set: update }, { new: true });
        res.json({ success: true, message: "Clinical Summary Updated", data: appointment });
    } catch (error) { res.status(500).json({ message: error.message }); }
};




// =========================================================================
// 🚀 NEW BEDSIDE TEAM WORKFLOW CONTROLLERS
// =========================================================================

// 1. REQUEST CO-DOCTOR BEDSIDE HELP (Primary Doctor Action)
const requestBedsideSpecialist = async (req, res) => {
    try {
        const { appointmentId, specialistDoctorId, reason, patientCondition, priority } = req.body;
        const mainDoctorId = req.user.id;

        const appointment = await Appointment.findOne({ _id: appointmentId, doctorId: mainDoctorId })
            .populate('bedId', 'bedNumber')
            .populate('userId', 'name');

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Unauthorized: You are not the primary treating physician for this patient." });
        }

        // Check if specialist already requested
        const exists = appointment.bedsideCareTeam.find(d => d.doctorId.toString() === specialistDoctorId);
        if (exists) {
            return res.status(400).json({ success: false, message: "This specialist is already requested or active on the care team." });
        }

        const now = new Date();

        // Push new bedside request
        appointment.bedsideCareTeam.push({
            doctorId: specialistDoctorId,
            status: 'Pending',
            requestReason: reason || "Specialist consultation requested.",
            patientConditionAtRequest: patientCondition || "Stable",
            priority: priority || 'Routine',
            requestedAt: now
        });

        appointment.markModified('bedsideCareTeam');
        await appointment.save();

        // 🚀 REAL-TIME ALERT: Push Notification sent to the requested Specialist Doctor
        const { sendPushNotification } = require('../../../utils/notification');
        const primaryPatient = appointment.patients?.[0]?.patientName || appointment.userId?.name || "Patient";
        const bedLabel = appointment.bedId?.bedNumber || appointment.bedNumber || "Ward Bed";

        await sendPushNotification(
            specialistDoctorId,
            'doctor',
            "🚨 Urgent Bedside Specialist Request!",
            `Dr. ${req.user.name} has requested your bedside consultation for patient ${primaryPatient} at Bed ${bedLabel}. Priority: ${priority || 'Routine'}.`,
            { appointmentId: appointment._id.toString(), type: 'bedside_specialist_request' }
        );

        res.status(201).json({ 
            success: true, 
            message: "Bedside help request sent to specialist and mobile notification dispatched successfully!" 
        });

    } catch (error) {
        console.error("Request Bedside Specialist Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// 2. RESPOND TO BEDSIDE REQUEST (Specialist Doctor Action: Accept or Reject with Reason)
const respondToBedsideRequest = async (req, res) => {
    try {
        const { appointmentId, action, rejectionReason } = req.body; // action: 'Accepted' | 'Rejected'
        const specialistId = req.user.id;
        const specialistObjId = new mongoose.Types.ObjectId(specialistId);

        if (!appointmentId || !action) {
            return res.status(400).json({ success: false, message: "Appointment ID and Action ('Accepted'/'Rejected') are required." });
        }

        const appointment = await Appointment.findOne({ 
            _id: appointmentId, 
            "bedsideCareTeam": {
                $elemMatch: {
                    doctorId: specialistObjId,
                    status: "Pending"
                }
            }
        });

        if (!appointment) {
            return res.status(404).json({ success: false, message: "No pending bedside request found for you on this case." });
        }

        // Find specialist object in array and update
        const careTeamObj = appointment.bedsideCareTeam.find(d => 
            d.doctorId && (d.doctorId.toString() === specialistId.toString() || d.doctorId._id?.toString() === specialistId.toString())
        );

        if (careTeamObj) {
            careTeamObj.status = action;
            careTeamObj.respondedAt = new Date();

            if (action === 'Rejected') {
                careTeamObj.rejectionReason = rejectionReason || "Doctor busy on another emergency case.";
            } else if (action === 'Accepted') {
                careTeamObj.startTime = new Date(); // Start treatment shift timing
            }
        }

        // 🚨 Mark modified so Mongoose saves changes inside the nested subdocument array
        appointment.markModified('bedsideCareTeam');
        await appointment.save();

        res.json({ 
            success: true, 
            message: `Bedside specialist request successfully ${action}!`, 
            data: appointment 
        });

    } catch (error) {
        console.error("Respond Bedside Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 14. START SPECIALIST TREATMENT SHIFT (Specialist Action - NEW API) ---
const startSpecialistCare = async (req, res) => {
    try {
        const { appointmentId } = req.body;
        const specialistId = req.user.id;

        const appointment = await Appointment.findOne({
            _id: appointmentId,
            "bedsideCareTeam.doctorId": specialistId,
            "bedsideCareTeam.status": "Accepted" // Must be accepted first to start
        });

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Accepted bedside request not found or unauthorized." });
        }

        // Find specialist and transition status: Accepted ➔ In-Progress
        const careTeamObj = appointment.bedsideCareTeam.find(d => d.doctorId.toString() === specialistId);
        careTeamObj.status = 'In-Progress';
        careTeamObj.startTime = new Date(); // 👈 Start of treatment shift timing!

        await appointment.save();
        res.json({ success: true, message: "Bedside specialist treatment started successfully. Status: In-Progress!", data: appointment });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. SUBMIT CO-DOCTOR CLINICAL FEEDBACK (Fixed: Allows MULTIPLE feedbacks while In-Progress) ---
const submitSpecialistFeedback = async (req, res) => {
    try {
        const body = req.body || {};
        
        // 1. Flexible Appointment ID Resolution
        const appointmentId = body.appointmentId || body.id || body.caseId || req.query.appointmentId;
        const specialistId = req.user.id;

        if (!appointmentId) {
            return res.status(400).json({ success: false, message: "Appointment ID is required." });
        }

        // 2. Verify specialist active treatment shift
        const appointment = await Appointment.findOne({ 
            _id: appointmentId, 
            "bedsideCareTeam.doctorId": specialistId,
            "bedsideCareTeam.status": { $in: ["In-Progress", "Accepted"] } 
        });

        if (!appointment) {
            return res.status(403).json({ success: false, message: "Unauthorized: Aapka treatment shift active nahi hai." });
        }

        if (['Discharge-Pending', 'Completed'].includes(appointment.status)) {
            return res.status(400).json({ 
                success: false, 
                message: "Clinical Block: Patient ka treatment officially end ho chuka hai." 
            });
        }

        const careTeamObj = appointment.bedsideCareTeam.find(d => d.doctorId.toString() === specialistId);
        
        if (careTeamObj.status === 'Accepted') {
            careTeamObj.status = 'In-Progress';
            careTeamObj.startTime = careTeamObj.startTime || new Date(); 
        }

        if (!careTeamObj.specialistFeedback) {
            careTeamObj.specialistFeedback = [];
        }

        // 🚨 3. UNIVERSAL NEXT.JS MULTI-KEY VITALS PARSER (Catches all frontend naming variations)
        let rawVitals = body.vitals;
        if (typeof rawVitals === 'string') {
            try { rawVitals = JSON.parse(rawVitals); } catch (e) { rawVitals = {}; }
        }
        rawVitals = rawVitals || {};

        const bpValue = rawVitals.bp || rawVitals.bloodPressure || rawVitals.blood_pressure || rawVitals.BP ||
                        body.bp || body.bloodPressure || body.blood_pressure || body.BP || "";

        const pulseValue = rawVitals.pulse || rawVitals.pulseRate || rawVitals.pulse_rate || rawVitals.heartRate || rawVitals.heart_rate ||
                           body.pulse || body.pulseRate || body.pulse_rate || body.heartRate || body.heart_rate || "";

        const tempValue = rawVitals.temp || rawVitals.temperature || rawVitals.bodyTemp || rawVitals.body_temperature ||
                          body.temp || body.temperature || body.bodyTemp || body.body_temperature || "";

        const spo2Value = rawVitals.spo2 || rawVitals.spO2 || rawVitals.spo_2 || rawVitals.oxygen || rawVitals.oxygenSaturation ||
                          body.spo2 || body.spO2 || body.spo_2 || body.oxygen || body.oxygenSaturation || "";

        const parsedVitals = {
            bp: String(bpValue).trim(),
            pulse: String(pulseValue).trim(),
            temp: String(tempValue).trim(),
            spo2: String(spo2Value).trim()
        };

        // 🚨 4. Push observation feedback
        careTeamObj.specialistFeedback.push({
            observation: body.observation || body.notes || "",
            patientCondition: body.patientCondition || body.condition || "Stable",
            priorityRating: body.priorityRating || body.priority || 'Routine',
            vitals: parsedVitals,
            submittedAt: new Date()
        });

        // 🚨 5. Parse Recommended Medicines safely
        const incomingMeds = body.recommendedMedicines || body.medicines;
        if (incomingMeds) {
            let medicinesArray = [];
            if (typeof incomingMeds === 'string') {
                try { medicinesArray = JSON.parse(incomingMeds); } catch (e) { medicinesArray = []; }
            } else if (Array.isArray(incomingMeds)) {
                medicinesArray = incomingMeds;
            }
            
            if (medicinesArray.length > 0) {
                if (!careTeamObj.recommendedMedicines) {
                    careTeamObj.recommendedMedicines = [];
                }

                medicinesArray.forEach(med => {
                    if (med && med.name) {
                        careTeamObj.recommendedMedicines.push({
                            name: med.name,
                            dosage: med.dosage || med.dose || "",
                            frequency: med.frequency || med.time || "",
                            duration: med.duration || "",
                            instructions: med.instructions || "",
                            type: med.type || 'Active-Stay', 
                            addedAt: new Date()
                        });
                    }
                });
            }
        }

        // 🚨 6. Deep Mongoose change tracking notification
        appointment.markModified('bedsideCareTeam');

        await appointment.save();

        res.json({ 
            success: true, 
            message: "Clinical feedback, vitals, and medication recommendations recorded successfully!",
            data: careTeamObj.specialistFeedback[careTeamObj.specialistFeedback.length - 1]
        });

    } catch (error) {
        console.error("Specialist Feedback Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Endpoint: GET /hospital-doctor/panel/case/bedside-medications/:appointmentId
const getCollaborativeMedications = async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const currentDoctorId = req.user.id;

        const appointment = await Appointment.findById(appointmentId)
            .populate({
                path: 'bedsideCareTeam.doctorId',
                select: 'name speciality qualification profileImage'
            });

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Admission Record Not Found." });
        }

        // 🛡️ ENHANCEMENT: Allow access to BOTH Primary Physician AND Accepted Bedside Specialists
        const isPrimaryDoc = appointment.doctorId && appointment.doctorId.toString() === currentDoctorId.toString();
        const isCareTeamMember = appointment.bedsideCareTeam.some(d => 
            d.doctorId && d.doctorId._id?.toString() === currentDoctorId.toString() && ['Accepted', 'In-Progress', 'Completed'].includes(d.status)
        );

        if (!isPrimaryDoc && !isCareTeamMember) {
            return res.status(403).json({ 
                success: false, 
                message: "Access Denied: Only treating primary physicians or bedside care team members can review collaborative medications." 
            });
        }

        const collaborativeList = appointment.bedsideCareTeam
            .filter(member => ['Completed', 'In-Progress', 'Accepted'].includes(member.status))
            .map(member => {
                const meds = member.recommendedMedicines || [];
                return {
                    doctor: {
                        id: member.doctorId?._id,
                        name: member.doctorId?.name || "Specialist",
                        speciality: member.doctorId?.speciality || "Specialist",
                        profileImage: member.doctorId?.profileImage || null
                    },
                    activeStayRecommendations: meds.filter(m => m.type === 'Active-Stay'),
                    dischargeHomeRecommendations: meds.filter(m => m.type === 'Discharge-Home')
                };
            });

        res.json({
            success: true,
            data: collaborativeList
        });

    } catch (error) {
        console.error("Collaborative meds fetch error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// --- 13. CLOSE SPECIALIST CARE TREATMENT (Specialist Action) ---
const completeSpecialistCare = async (req, res) => {
    try {
        const { appointmentId } = req.body;
        const specialistId = req.user.id;

        const appointment = await Appointment.findOne({
            _id: appointmentId,
            "bedsideCareTeam.doctorId": specialistId,
            "bedsideCareTeam.status": "In-Progress" // Must be active (In-Progress) to complete
        });

        if (!appointment) {
            return res.status(404).json({ 
                success: false, 
                message: "Active In-Progress bedside treatment record not found or unauthorized." 
            });
        }

        const now = new Date();

        // Find specialist and transition status: In-Progress ➔ Completed
        const careTeamObj = appointment.bedsideCareTeam.find(d => d.doctorId.toString() === specialistId);
        careTeamObj.status = 'Completed';
        careTeamObj.endTime = now; // 👈 End of treatment shift timing!
        
        // Dynamic duration display calculation
        careTeamObj.durationDisplay = calculateDurationDisplay(careTeamObj.startTime, now);

        await appointment.save();
        res.json({ success: true, message: "Your bedside treatment phase has been successfully marked as Completed!", data: appointment });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get Cases Assigned to Hospital Doctor (Defaults to Today's Live Queue for OPD Tab)
// @route   GET /hospital-doctor/panel/cases
// @access  Private (Hospital Doctor)
const getAssignedCases = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { tab = 'all', date, search } = req.query;

        let query = { 
            doctorId,
            status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital'] }
        };

        // Filter by Tab
        if (tab === 'opd') {
            query.bookingType = 'OPD';
            
            // 🚨 Smart Default: If date is not specified, default to TODAY'S OPD QUEUE!
            if (!date) {
                query.appointmentDate = {
                    $gte: moment().startOf('day').toDate(),
                    $lte: moment().endOf('day').toDate()
                };
            }
        } else if (tab === 'ipd') {
            query.bookingType = 'Admission';
        } else if (tab === 'emergency') {
            query.triageLevel = 'Emergency';
        }

        // Custom Date Filter (if specifically passed)
        if (date && date !== 'all') {
            query.appointmentDate = {
                $gte: moment(date).startOf('day').toDate(),
                $lte: moment(date).endOf('day').toDate()
            };
        }

        if (search && search.trim() !== '') {
            query.$or = [
                { bookingId: { $regex: search.trim(), $options: 'i' } },
                { 'patients.patientName': { $regex: search.trim(), $options: 'i' } }
            ];
        }

        // OPD sorts by Token Number ascending; IPD sorts by newest first
        const sortOptions = tab === 'opd' 
            ? { tokenNumber: 1, createdAt: 1 } 
            : { createdAt: -1 };

        const cases = await Appointment.find(query)
            .populate('userId', 'name phone email profilePic age gender')
            .populate({
                path: 'bedId',
                select: 'bedNumber status pricePerDay',
                populate: { path: 'wardId', select: 'name type' }
            })
            .sort(sortOptions)
            .lean();

        const formattedCases = cases.map(c => {
            const isOpd = c.bookingType === 'OPD';
            const primaryPatient = (Array.isArray(c.patients) && c.patients.length > 0)
                ? c.patients[0]
                : { patientName: c.userId?.name || "Patient", patientAge: 30, gender: "Male" };

            return {
                ...c,
                isOpd,
                isIpd: !isOpd,
                patientDisplayName: primaryPatient.patientName,
                patientAgeGender: `${primaryPatient.patientAge || 'N/A'} Yrs / ${primaryPatient.gender || 'N/A'}`,
                displayBadge: isOpd ? `Token #${c.tokenNumber || '1'}` : (c.bedNumber ? `Bed: ${c.bedNumber}` : 'IPD Admission'),
                opdRoomNumber: c.opdRoomNumber || "Cabin 1",
                canStartConsultation: isOpd && (c.status === 'Confirmed' || c.status === 'Hospital-Pending'),
                canWritePrescription: c.status === 'In-Progress' || (isOpd && c.status === 'Confirmed'),
                canMarkNoShow: isOpd && ['Confirmed', 'In-Progress'].includes(c.status)
            };
        });

        res.status(200).json({
            success: true,
            tab,
            count: formattedCases.length,
            isTodayQueue: tab === 'opd' && !date,
            data: formattedCases
        });

    } catch (error) {
        console.error("Get Assigned Cases Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// Fetch existing prescriptions for a patient/appointment
const getPrescriptionsByAppointment = async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const prescriptions = await Prescription.find({ appointmentId })
            .populate('doctorId', 'name speciality qualification')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: prescriptions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 🚀 NEW CONTROLLER: Delete wrongly submitted prescriptions
const deletePrescriptionById = async (req, res) => {
    try {
        const { id } = req.params;
        const prescription = await Prescription.findOneAndDelete({ _id: id, doctorId: req.user.id });
        
        if (!prescription) {
            return res.status(404).json({ success: false, message: "Prescription not found or unauthorized." });
        }
        res.json({ success: true, message: "Prescription successfully deleted." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 🚀 NEW CONTROLLER: Get Raw Discharge Summary data for Pre-Print View
const getRawDischargeSummary = async (req, res) => {
    try {
        const { id } = req.params; // Appointment/Admission ID
        const appointment = await Appointment.findById(id)
            .select('clinicalSummary status bookingId')
            .lean();

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Admission Record Not Found." });
        }

        res.json({ success: true, data: appointment });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get Single Case Details for Hospital Doctor (Handles Both OPD Token Details & IPD Ward Chart)
// @route   GET /hospital-doctor/panel/case-details/:id
// @access  Private (Hospital Doctor)
const getPatientDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const doctorId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            doctorId,
            ...(isObjectId ? { _id: id } : { bookingId: String(id).trim() })
        };

        const appointment = await Appointment.findOne(query)
            .populate('userId', 'name phone email profilePic age gender bloodGroup')
            .populate('hospitalId', 'name address city state phone')
            .populate({
                path: 'bedId',
                select: 'bedNumber status pricePerDay isVentilatorAvailable wardId',
                populate: { path: 'wardId', select: 'name type' }
            })
            .populate('bedsideCareTeam.doctorId', 'name speciality profileImage dutyStatus')
            .populate('clinicalLogs.doctorId', 'name speciality')
            .lean();

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment case not found or access denied." });
        }

        const isOpd = appointment.bookingType === 'OPD';

        // Fetch Digital Prescriptions issued for this appointment
        const prescriptions = await Prescription.find({ appointmentId: appointment._id })
            .sort({ createdAt: -1 })
            .lean();

        const primaryPatient = (Array.isArray(appointment.patients) && appointment.patients.length > 0)
            ? appointment.patients[0]
            : { patientName: appointment.userId?.name || "Patient", patientAge: 30, gender: "Male" };

        res.status(200).json({
            success: true,
            data: {
                ...appointment,
                isOpd,
                isIpd: !isOpd,
                patientSummary: {
                    name: primaryPatient.patientName,
                    age: primaryPatient.patientAge,
                    gender: primaryPatient.gender,
                    bloodGroup: primaryPatient.bloodGroup || appointment.userId?.bloodGroup || "Not Provided",
                    relation: primaryPatient.relation || "Self",
                    contactPhone: appointment.userId?.phone || "N/A",
                    profilePic: appointment.userId?.profilePic || null
                },
                // OPD Specific Metadata
                opdInfo: isOpd ? {
                    tokenNumber: appointment.tokenNumber,
                    opdRoomNumber: appointment.opdRoomNumber || "Cabin 1",
                    appointmentTime: appointment.appointmentTime,
                    appointmentDate: moment(appointment.appointmentDate).format('YYYY-MM-DD'),
                    consultationFee: appointment.pricingBreakdown?.baseFee || 500,
                    reasonForVisit: appointment.bookingReason || primaryPatient.reasonForVisit || "Routine OPD Checkup"
                } : null,
                // IPD Specific Metadata
                ipdInfo: !isOpd ? {
                    wardName: appointment.wardName,
                    bedNumber: appointment.bedNumber,
                    startDate: appointment.startDate,
                    endDate: appointment.endDate,
                    stayDuration: appointment.stayDuration
                } : null,
                // Prescriptions List
                prescriptions: prescriptions || [],
                hasPrescription: prescriptions.length > 0,
                // Action Controls for Doctor UI
                actions: {
                    canStartConsultation: isOpd && ['Confirmed', 'Hospital-Pending'].includes(appointment.status),
                    canWritePrescription: appointment.status === 'In-Progress' || (isOpd && appointment.status === 'Confirmed'),
                    canMarkNoShow: isOpd && ['Confirmed', 'In-Progress'].includes(appointment.status),
                    canTransferDoctor: !isOpd && ['Confirmed', 'In-Progress'].includes(appointment.status),
                    canDischarge: !isOpd && appointment.status === 'In-Progress'
                }
            }
        });

    } catch (error) {
        console.error("Get Patient Details Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};



// --- API: GET PRINTABLE DIGITAL DISCHARGE SUMMARY (Figma Print Sheet Aligned) ---
const getPrintableDischargeSummary = async (req, res) => {
    try {
        const { id } = req.params;

        const appt = await Appointment.findById(id)
            .populate('userId', 'name phone email profilePic age gender bloodGroup country state city address')
            .populate('hospitalId', 'name address city state zipCode hospitalImage')
            .populate('doctorId', 'name speciality qualification')
            .populate({
                path: 'bedsideCareTeam.doctorId',
                select: 'name speciality qualification'
            })
            .populate({
                path: 'treatmentHistory.toDoctorId',
                select: 'name speciality qualification'
            });

        if (!appt) {
            return res.status(404).json({ success: false, message: "Admission Record Not Found." });
        }

        const prescription = await Prescription.findOne({ appointmentId: id }).sort({ createdAt: -1 });

        const dynamicHandoffDoctors = appt.bedsideCareTeam
            .filter(member => ['Completed', 'Accepted', 'In-Progress'].includes(member.status))
            .map(member => ({
                name: member.doctorId?.name || "Specialist",
                department: `Department of ${member.doctorId?.speciality || 'Medicine'}`
            }));

        if (appt.treatmentHistory && appt.treatmentHistory.length > 0) {
            appt.treatmentHistory.forEach(historyLog => {
                if (historyLog.toDoctorId && historyLog.endTime) {
                    const isCurrent = appt.doctorId && appt.doctorId._id?.toString() === historyLog.toDoctorId._id?.toString();
                    if (!isCurrent) {
                        const name = historyLog.toDoctorId.name;
                        const dept = `Department of ${historyLog.toDoctorId.speciality || 'Medicine'}`;
                        const exists = dynamicHandoffDoctors.some(d => d.name === name);
                        if (!exists && name) {
                            dynamicHandoffDoctors.push({ name, department: dept });
                        }
                    }
                }
            });
        }

        const formatPaymentMethod = (method) => {
            if (!method) return "";
            if (method.toUpperCase() === 'ONLINE' || method.toUpperCase() === 'UPI') return "UPI / Online";
            if (method.toUpperCase() === 'CASH' || method.toUpperCase() === 'COD') return "Cash / Offline";
            return method;
        };

        const patientBloodGroup = appt.clinicalSummary?.bloodGroup || 
                                  appt.patients?.[0]?.bloodGroup || 
                                  appt.userId?.bloodGroup || 
                                  "";

        const figmaDataSheet = {
            header: {
                hospitalName: appt.hospitalId?.name || "",
                hospitalAddress: appt.hospitalId?.address || "",
                hospitalLogo: appt.hospitalId?.hospitalImage?.[0] || null,
                leadDoctor: {
                    name: appt.doctorId?.name || "",
                    title: appt.doctorId?.speciality ? `Department of ${appt.doctorId.speciality}` : "",
                    qualification: appt.doctorId?.qualification || ""
                },
                collaborativeDoctors: dynamicHandoffDoctors
            },

            patientDetails: {
                appointmentId: appt.bookingId,
                name: appt.patients?.[0]?.patientName || appt.userId?.name || "",
                address: appt.address?.city ? `${appt.address.houseNo || ''} ${appt.address.city}` : (appt.userId?.address || ""),
                gender: appt.patients?.[0]?.gender || appt.userId?.gender || "",
                age: appt.patients?.[0]?.patientAge || appt.userId?.age || "",
                bloodGroup: patientBloodGroup,
                
                dateOfAdmission: appt.startDate ? moment(appt.startDate).format("YYYY-MM-DD") : "",
                department: appt.doctorId?.speciality 
                    ? `Department of ${appt.doctorId.speciality}` 
                    : "",
                
                dateOfDischarge: appt.endDate ? moment(appt.endDate).format("YYYY-MM-DD") : "",
                dateOfSurgery: appt.clinicalSummary?.dateOfSurgery 
                    ? moment(appt.clinicalSummary.dateOfSurgery).format("YYYY-MM-DD") 
                    : "",
                
                insuranceStatus: appt.insuranceDetails?.hasInsurance || appt.hasInsurance ? "Verified (Cashless)" : "Non-Insured",
                paymentStatus: appt.paymentStatus || "",
                paymentType: formatPaymentMethod(appt.paymentMethod),
                
                conditionDuringAdmission: appt.clinicalSummary?.conditionDuringAdmission || "",
                conditionDuringDischarge: appt.clinicalSummary?.conditionDuringDischarge || "",

                chiefComplaints: appt.clinicalSummary?.chiefComplaint || appt.patients?.[0]?.reasonForVisit || "",
                diagnosis: appt.clinicalSummary?.diagnosis || ""
            },

            clinicalNotes: appt.clinicalSummary?.admissionNote || "",

            medications: prescription ? prescription.medicines.map((med, idx) => ({
                sNo: String(idx + 1).padStart(2, '0'),
                medicineName: med.name,
                dose: med.dosage || "",
                time: med.frequency || "",
                duration: med.duration || ""
            })) : [],

            followUp: {
                adviseInvestigation: appt.clinicalSummary?.investigation || "",
                adviceGiven: appt.clinicalSummary?.dischargeNote || "",
                anySpecialInstructionGiven: "This digital Discharge Document is generated via verified hospital clinical records.",
                nextAppointment: appt.endDate ? moment(appt.endDate).add(7, 'days').format("YYYY-MM-DD") : ""
            }
        };

        res.json({
            success: true,
            data: figmaDataSheet
        });

    } catch (error) {
        console.error("Discharge summary fetch error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// @desc    Get Past Completed / Closed Cases History for Hospital Doctor (Supports Tab: 'opd', 'ipd', 'all')
// @route   GET /hospital-doctor/panel/cases/history-list
// @access  Private (Hospital Doctor)
const getDoctorHistory = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { type = 'all', page = 1, limit = 20, search } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 20);
        const skip = (pageNum - 1) * limitNum;

        let query = {
            doctorId,
            status: { $in: ['Completed', 'No-Show', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital'] }
        };

        if (type === 'opd') {
            query.bookingType = 'OPD';
        } else if (type === 'ipd') {
            query.bookingType = 'Admission';
        }

        if (search && search.trim() !== '') {
            query.$or = [
                { bookingId: { $regex: search.trim(), $options: 'i' } },
                { 'patients.patientName': { $regex: search.trim(), $options: 'i' } }
            ];
        }

        const [totalItems, history] = await Promise.all([
            Appointment.countDocuments(query),
            Appointment.find(query)
                .populate('userId', 'name phone profilePic')
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean()
        ]);

        const formattedHistory = history.map(item => {
            const isOpd = item.bookingType === 'OPD';
            const primaryPatient = (Array.isArray(item.patients) && item.patients.length > 0)
                ? item.patients[0]
                : { patientName: item.userId?.name || "Patient" };

            return {
                _id: item._id,
                bookingId: item.bookingId,
                bookingType: item.bookingType,
                isOpd,
                isIpd: !isOpd,
                patientName: primaryPatient.patientName,
                displayTag: isOpd ? `OPD Token #${item.tokenNumber || '1'}` : (item.bedNumber ? `Bed: ${item.bedNumber}` : 'IPD Admission'),
                dateFormatted: isOpd 
                    ? moment(item.appointmentDate).format('DD MMM YYYY')
                    : `${moment(item.startDate).format('DD MMM')} - ${moment(item.endDate).format('DD MMM YYYY')}`,
                timeSlot: item.appointmentTime || "N/A",
                status: item.status,
                reasonForVisit: item.bookingReason || "General Consultation",
                completedAt: item.updatedAt
            };
        });

        res.status(200).json({
            success: true,
            totalItems,
            totalPages: Math.ceil(totalItems / limitNum) || 1,
            currentPage: pageNum,
            count: formattedHistory.length,
            data: formattedHistory
        });

    } catch (error) {
        console.error("Get Doctor History Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// --- 14. GET PENDING WARD ADMISSIONS (NEW API - Waiting for Doctor Assignment) ---
// Endpoint: GET /hospital-doctor/panel/cases/pending-admissions
const getPendingAdmissions = async (req, res) => {
    try {
        const hospitalId = req.user.hospitalId;
        if (!hospitalId) {
            return res.status(400).json({ 
                success: false, 
                message: "Unauthorized: You are not associated with any hospital." 
            });
        }

        const admissions = await Appointment.find({
            hospitalId,
            bookingType: 'Admission',
            doctorId: null,
            status: 'In-Progress' 
        })
        .populate('userId', 'name phone email profilePic age gender bloodGroup familyMember')
        .populate({
            path: 'bedId',
            select: 'bedNumber pricePerDay status',
            populate: { path: 'wardId', select: 'name type' }
        })
        .sort({ createdAt: -1 });

        const cleanedPending = admissions.map(appt => ({
            _id: appt._id,
            bookingId: appt.bookingId,
            status: appt.status,
            startDate: appt.startDate,
            endDate: appt.endDate,
            stayDuration: appt.stayDuration || 1,

            patientDetails: resolvePatientDTO(appt),

            bedDetails: appt.bedId ? {
                _id: appt.bedId._id,
                bedNumber: appt.bedId.bedNumber,
                pricePerDay: appt.bedId.pricePerDay,
                wardName: appt.bedId.wardId?.name || "N/A"
            } : null,

            createdAt: appt.createdAt
        }));

        res.json({ success: true, count: cleanedPending.length, data: cleanedPending });
    } catch (error) {
        console.error("getPendingAdmissions Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 15. TAKE CHARGE OF WARD ADMISSION (NEW API - Self Doctor Assignment) ---
const takeChargeOfAdmission = async (req, res) => {
    try {
        const { appointmentId } = req.body;
        const doctorId = req.user.id;

        // Verify patient is currently admitted, belongs to same hospital, and has no doctor assigned
        const appointment = await Appointment.findOne({
            _id: appointmentId,
            hospitalId: req.user.hospitalId,
            doctorId: null,
            status: 'In-Progress'
        });

        if (!appointment) {
            return res.status(404).json({ 
                success: false, 
                message: "Patient already assigned to another doctor, discharged, or record not found." 
            });
        }

        const now = new Date();

        // Assign Doctor & Start Treatment Shift Tracking
        appointment.doctorId = doctorId;
        appointment.treatmentHistory.push({
            toDoctorId: doctorId,
            action: 'Initial-Assignment',
            notes: `Dr. ${req.user.name} took charge of the ward admission.`,
            timestamp: now,
            startTime: now // Start shift tracking!
        });

        await appointment.save();
        res.json({ success: true, message: "Aapne patient ka charge le liya hai. Ward case activated.", data: appointment });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// --- API: DOCTOR SELF-ASSIGN UNASSIGNED CASE (NEW API) ---
// Endpoint: POST /hospital-doctor/panel/case/self-assign
const doctorSelfAssignCase = async (req, res) => {
    try {
        const { appointmentId } = req.body;
        const doctorId = req.user.id;

        // Verify patient is currently unassigned (doctorId is null) and belongs to same hospital
        const appointment = await Appointment.findOne({
            _id: appointmentId,
            hospitalId: req.user.hospitalId,
            doctorId: null // Checks strictly unassigned state
        });

        if (!appointment) {
            return res.status(400).json({ 
                success: false, 
                message: "Self-Assign Failed: Patient already assigned to another doctor, completed, or not found." 
            });
        }

        const now = new Date();

        // Assign Doctor & Start Treatment Shift Tracking
        appointment.doctorId = doctorId;
        appointment.treatmentHistory.push({
            toDoctorId: doctorId,
            action: 'Initial-Assignment',
            notes: `Dr. ${req.user.name} self-assigned this case.`,
            timestamp: now,
            startTime: now // Start shift tracking!
        });

        await appointment.save();
        res.json({ success: true, message: "Aapne patient ka case successfully self-assign kar liya hai.", data: appointment });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Endpoint: POST /hospital-doctor/panel/case/clinical-log/add
// Path: controllers/hospital/Doctor/hosDocPanel.js
const addPrimaryClinicalLog = async (req, res) => {
    try {
        const { appointmentId, observation, patientCondition, priorityRating, vitals } = req.body;
        const doctorId = req.user.id;

        if (!appointmentId || !observation) {
            return res.status(400).json({ success: false, message: "Appointment ID and Observation findings are required." });
        }

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Admission Case Record Not Found." });
        }

        const isPrimaryDoc = appointment.doctorId && appointment.doctorId.toString() === doctorId.toString();
        if (!isPrimaryDoc) {
            return res.status(403).json({ success: false, message: "Unauthorized: Only the assigned primary physician can submit active round observations." });
        }

        // Parse incoming round vitals
        let parsedVitals = { bp: "", pulse: "", temp: "", spo2: "" };
        if (vitals) {
            parsedVitals = typeof vitals === 'string' ? JSON.parse(vitals) : vitals;
        }

        // Push new clinical observation log with vitals and current timestamp
        appointment.clinicalLogs.push({
            doctorId,
            observation,
            patientCondition: patientCondition || 'Stable',
            priorityRating: priorityRating || 'Routine',
            vitals: {
                bp: parsedVitals.bp || "",
                pulse: parsedVitals.pulse || "",
                temp: parsedVitals.temp || "",
                spo2: parsedVitals.spo2 || ""
            },
            loggedAt: new Date()
        });

        await appointment.save();

        res.status(201).json({
            success: true,
            message: "Clinical observation log recorded successfully.",
            data: appointment.clinicalLogs[appointment.clinicalLogs.length - 1]
        });

    } catch (error) {
        console.error("Add Clinical Log Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- API: ADD IN-PATIENT ACTIVE MEDICATION (NEW API - Figma stay meds flow) ---
// Endpoint: POST /hospital-doctor/panel/case/active-medication/add
// Path: controllers/hospital/Doctor/hosDocPanel.js
const addActiveMedication = async (req, res) => {
    try {
        const { appointmentId, medicineName, dosage, frequency, instructions } = req.body;
        const doctorId = req.user.id;

        if (!appointmentId || !medicineName) {
            return res.status(400).json({ success: false, message: "Appointment ID and Medicine name are required." });
        }

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Admission record not found." });
        }

        // Authorization: Only primary treating doctor or accepted bedside specialist can order stay medications
        const isPrimaryDoc = appointment.doctorId && appointment.doctorId.toString() === doctorId.toString();
        const isCareTeamMember = appointment.bedsideCareTeam.some(d => 
            d.doctorId.toString() === doctorId.toString() && ['Accepted', 'In-Progress'].includes(d.status)
        );

        if (!isPrimaryDoc && !isCareTeamMember) {
            return res.status(403).json({ success: false, message: "Access Denied: Only treating physicians can order in-patient active medications." });
        }

        // Push new active medication order
        appointment.activeMedications.push({
            medicineName,
            dosage: dosage || "",
            frequency: frequency || "",
            instructions: instructions || "",
            addedBy: doctorId,
            status: 'Active',
            startDate: new Date()
        });

        await appointment.save();

        res.status(201).json({
            success: true,
            message: "Active in-patient medication successfully added.",
            data: appointment.activeMedications[appointment.activeMedications.length - 1]
        });

    } catch (error) {
        console.error("Add Active Med Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- API: STOP/DISCONTINUE IN-PATIENT ACTIVE MEDICATION (NEW API) ---
// Endpoint: PATCH /hospital-doctor/panel/case/active-medication/stop
// Path: controllers/hospital/Doctor/hosDocPanel.js
const stopActiveMedication = async (req, res) => {
    try {
        const { appointmentId, medicationRecordId } = req.body;
        const doctorId = req.user.id;

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) return res.status(404).json({ success: false, message: "Admission record not found." });

        // Authorization check
        const isPrimaryDoc = appointment.doctorId && appointment.doctorId.toString() === doctorId.toString();
        const isCareTeamMember = appointment.bedsideCareTeam.some(d => 
            d.doctorId.toString() === doctorId.toString() && ['Accepted', 'In-Progress'].includes(d.status)
        );

        if (!isPrimaryDoc && !isCareTeamMember) {
            return res.status(403).json({ success: false, message: "Access Denied: Unauthorized to adjust active medications." });
        }

        // Locate target medication within array and update state
        const medRecord = appointment.activeMedications.id(medicationRecordId);
        if (!medRecord) {
            return res.status(404).json({ success: false, message: "Medication record not found." });
        }

        medRecord.status = 'Stopped';
        medRecord.stoppedDate = new Date();

        await appointment.save();
        res.json({ success: true, message: "In-patient medication discontinued successfully.", data: medRecord });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};






// @desc    Hospital Doctor Views His OPD Settings, Room Number, Timings & Premium Slots
// @route   GET /hospital-doctor/panel/opd-settings
// @access  Private (Hospital Doctor)
const getDoctorOpdSettings = async (req, res) => {
    try {
        const doctorId = req.user.id;

        const doctor = await Doctor.findById(doctorId)
            .select('name speciality fees department slotDuration availability consultationStatus hospitalId')
            .populate('hospitalId', 'name city address')
            .lean();

        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor profile not found." });
        }

        const safeObjectParse = (val, defaultVal = {}) => {
            if (!val) return defaultVal;
            if (typeof val === 'object' && val !== null) return val;
            if (typeof val === 'string') {
                try {
                    const parsed = JSON.parse(val);
                    if (typeof parsed === 'object' && parsed !== null) return parsed;
                } catch (e) {}
            }
            return defaultVal;
        };

        const consultation = safeObjectParse(doctor.consultationStatus, { online: true, clinic: true, home: true });
        const fees = safeObjectParse(doctor.fees, { online: 0, clinic: 500, home: 0 });
        const department = safeObjectParse(doctor.department, { isNormal: true, isEmergency: false, roomNumber: "Cabin 1" });

        // Fetch Availability Config to get Premium Slots & Blocked Slots
        const availabilityConfig = await Availability.findOne({ 
            vendorId: doctorId, 
            vendorType: 'Doctor' 
        }).lean();

        res.status(200).json({
            success: true,
            data: {
                doctorId: doctor._id,
                name: doctor.name,
                speciality: doctor.speciality,
                hospital: doctor.hospitalId,
                opdRoomNumber: department.roomNumber || null,
                opdFee: Number(fees.clinic !== undefined ? fees.clinic : 0),
                slotDurationMinutes: doctor.slotDuration || 15,
                isOpdEnabled: Boolean(consultation.clinic ?? true),
                weeklySchedule: doctor.availability || [
                    { day: "Mon", startTime: "09:00", endTime: "17:00" },
                    { day: "Tue", startTime: "09:00", endTime: "17:00" },
                    { day: "Wed", startTime: "09:00", endTime: "17:00" },
                    { day: "Thu", startTime: "09:00", endTime: "17:00" },
                    { day: "Fri", startTime: "09:00", endTime: "17:00" },
                    { day: "Sat", startTime: "09:00", endTime: "13:00" }
                ],
                premiumSlots: availabilityConfig?.premiumSlots || [], // 👈 Configured Premium Slots
                blockedSlots: availabilityConfig?.unavailableSlots || []
            }
        });

    } catch (error) {
        console.error("Get Doctor OPD Settings Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// @desc    Hospital Doctor Updates OPD Cabin Room, Fee, Timings & Premium Slots
// @route   PUT /hospital-doctor/panel/opd-settings
// @access  Private (Hospital Doctor)
const updateDoctorOpdSettings = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { roomNumber, slotDuration, clinicFee, availability, isOpdEnabled, premiumSlots } = req.body;

        const doctor = await Doctor.findById(doctorId).select('+password').lean();
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor profile not found." });
        }

        const safeObjectParse = (val, defaultVal = {}) => {
            if (!val) return defaultVal;
            if (typeof val === 'object' && val !== null) return val;
            if (typeof val === 'string') {
                try {
                    const parsed = JSON.parse(val);
                    if (typeof parsed === 'object' && parsed !== null) return parsed;
                } catch (e) {}
            }
            return defaultVal;
        };

        let currentConsultation = safeObjectParse(doctor.consultationStatus, { online: true, clinic: true, home: true });
        if (isOpdEnabled !== undefined) {
            currentConsultation.clinic = (isOpdEnabled === true || isOpdEnabled === 'true');
        }

        let currentFees = safeObjectParse(doctor.fees, { online: 0, clinic: 500, home: 0 });
        if (clinicFee !== undefined) {
            currentFees.clinic = Math.max(0, parseInt(clinicFee) || 0);
        }

        let currentDepartment = safeObjectParse(doctor.department, { isNormal: true, isEmergency: false, roomNumber: "Cabin 1" });
        if (roomNumber !== undefined) {
            currentDepartment.roomNumber = String(roomNumber).trim();
        }

        const updatePayload = {
            consultationStatus: currentConsultation,
            fees: currentFees,
            department: currentDepartment
        };

        if (slotDuration !== undefined) {
            updatePayload.slotDuration = Math.max(5, parseInt(slotDuration) || 15);
        }

        if (availability !== undefined) {
            updatePayload.availability = Array.isArray(availability)
                ? availability
                : (typeof availability === 'string' ? safeObjectParse(availability, []) : []);
        }

        // 1. Update Doctor Document
        await Doctor.collection.updateOne(
            { _id: new mongoose.Types.ObjectId(doctorId) },
            { $set: updatePayload }
        );

        // 2. Update Premium Slots in Availability Collection
        if (premiumSlots !== undefined) {
            const formattedPremiumSlots = Array.isArray(premiumSlots) ? premiumSlots : safeObjectParse(premiumSlots, []);
            await Availability.findOneAndUpdate(
                { vendorId: doctorId, vendorType: 'Doctor' },
                { $set: { premiumSlots: formattedPremiumSlots } },
                { upsert: true, new: true }
            );
        }

        const updatedDoctor = await Doctor.findById(doctorId)
            .select('name speciality fees department slotDuration availability consultationStatus')
            .lean();

        res.status(200).json({
            success: true,
            message: "Doctor OPD Cabin, Fee, Schedule and Premium Slots updated successfully.",
            data: updatedDoctor
        });

    } catch (error) {
        console.error("Update Doctor OPD Settings Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// @desc    Hospital Doctor Starts OPD Consultation for a Token (Enforces Single Active Token Per Cabin)
// @route   PATCH /hospital-doctor/panel/opd/start-consultation/:appointmentId
// @access  Private (Hospital Doctor)
const startOpdConsultation = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { appointmentId } = req.params;

        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const query = {
            doctorId,
            bookingType: 'OPD',
            ...(isObjectId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(query).populate('userId', 'name phone fcmToken');
        if (!appointment) {
            return res.status(404).json({ success: false, message: "OPD Appointment not found." });
        }

        // 🚨 QUEUE GUARD: Auto-close any previous unclosed in-progress token for this doctor today
        const todayStart = moment(appointment.appointmentDate).startOf('day').toDate();
        const todayEnd = moment(appointment.appointmentDate).endOf('day').toDate();

        await Appointment.updateMany(
            {
                doctorId,
                bookingType: 'OPD',
                status: 'In-Progress',
                appointmentDate: { $gte: todayStart, $lte: todayEnd },
                _id: { $ne: appointment._id }
            },
            { 
                $set: { 
                    status: 'Completed',
                    'clinicalSummary.dischargeNote': 'Auto-closed on next token call'
                } 
            }
        );

        appointment.status = 'In-Progress';
        await appointment.save();

        // Push alert to patient that doctor is ready in the cabin
        if (appointment.userId) {
            try {
                await sendPushNotification(
                    appointment.userId._id,
                    'user',
                    `Your Turn! Token #${appointment.tokenNumber}`,
                    `Dr. ${req.user.name || 'Doctor'} is ready for you in ${appointment.opdRoomNumber || 'OPD Cabin'}. Please proceed inside.`,
                    { appointmentId: appointment._id.toString(), type: 'opd_call_turn', tokenNumber: appointment.tokenNumber }
                );
            } catch (e) {}
        }

        res.status(200).json({
            success: true,
            message: `Consultation started for Token #${appointment.tokenNumber}. Status is now 'In-Progress'.`,
            tokenNumber: appointment.tokenNumber,
            data: appointment
        });

    } catch (error) {
        console.error("Start OPD Consultation Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Hospital Doctor Marks an OPD Patient as No-Show / Absent
// @route   PATCH /hospital-doctor/panel/opd/no-show/:appointmentId
// @access  Private (Hospital Doctor)
const markOpdNoShow = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { appointmentId } = req.params;
        const { reason } = req.body;

        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const query = {
            doctorId,
            bookingType: 'OPD',
            ...(isObjectId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(query);
        if (!appointment) {
            return res.status(404).json({ success: false, message: "OPD Appointment not found." });
        }

        appointment.status = 'No-Show';
        appointment.cancelReason = reason || "Patient did not report to the OPD cabin when token was called.";
        await appointment.save();

        res.status(200).json({
            success: true,
            message: `Token #${appointment.tokenNumber} marked as No-Show / Absent.`,
            data: appointment
        });

    } catch (error) {
        console.error("Mark OPD No-Show Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// @desc    Hospital Doctor Blocks or Unblocks a Specific Time Slot (e.g. for Emergency/Rounds)
// @route   POST /hospital-doctor/panel/opd-slots/toggle-block
// @access  Private (Hospital Doctor)
const toggleDoctorOpdSlotBlock = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { timeSlot, action } = req.body; // action: 'block' or 'unblock', timeSlot: "11:00 AM"

        if (!timeSlot || !action || !['block', 'unblock'].includes(action)) {
            return res.status(400).json({ 
                success: false, 
                message: "timeSlot (e.g. '11:00 AM') and action ('block' or 'unblock') are required." 
            });
        }

        const updateOperation = action === 'block'
            ? { $addToSet: { unavailableSlots: timeSlot.trim() } }
            : { $pull: { unavailableSlots: timeSlot.trim() } };

        const config = await Availability.findOneAndUpdate(
            { vendorId: doctorId, vendorType: 'Doctor' },
            updateOperation,
            { upsert: true, new: true }
        );

        res.status(200).json({
            success: true,
            message: `OPD Time Slot '${timeSlot}' successfully marked as ${action === 'block' ? 'Blocked / Unavailable' : 'Available'}.`,
            blockedSlots: config.unavailableSlots
        });

    } catch (error) {
        console.error("Toggle Doctor OPD Slot Block Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// @desc    Hospital Doctor Applies for Leave (Only for Future Dates, Today Blocked with Reason)
// @route   POST /hospital-doctor/panel/leaves/apply
// @access  Private (Hospital Doctor)
const applyDoctorLeave = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { startDate, endDate, reason } = req.body;

        if (!startDate || !endDate || !reason || String(reason).trim() === "") {
            return res.status(400).json({ 
                success: false, 
                message: "startDate, endDate, and explanation reason are mandatory." 
            });
        }

        const todayStart = moment().startOf('day');
        const reqStart = moment(startDate).startOf('day');
        const reqEnd = moment(endDate).endOf('day');

        // 🚨 Strict Rule: Today's and Past dates leave cannot be applied! Must be tomorrow onwards.
        if (reqStart.isSameOrBefore(todayStart)) {
            return res.status(400).json({
                success: false,
                message: "Restricted: You cannot apply leave for today or past dates. Leaves are allowed only for tomorrow onwards. For today's emergency absence, please block your specific OPD slots with reason."
            });
        }

        if (reqEnd.isBefore(reqStart)) {
            return res.status(400).json({
                success: false,
                message: "End date must be on or after start date."
            });
        }

        const doctor = await Doctor.findById(doctorId);
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor profile not found." });
        }

        // Check overlapping leave requests
        const isOverlapping = (doctor.leaves || []).some(l => {
            if (l.status === 'Rejected') return false;
            const lStart = moment(l.startDate).startOf('day');
            const lEnd = moment(l.endDate).endOf('day');
            return reqStart.isSameOrBefore(lEnd) && reqEnd.isSameOrAfter(lStart);
        });

        if (isOverlapping) {
            return res.status(400).json({
                success: false,
                message: "You already have a Pending or Approved leave overlapping with these dates."
            });
        }

        const newLeave = {
            startDate: reqStart.toDate(),
            endDate: reqEnd.toDate(),
            reason: String(reason).trim(),
            status: 'Pending',
            appliedAt: new Date()
        };

        if (!doctor.leaves) doctor.leaves = [];
        doctor.leaves.push(newLeave);
        await doctor.save();

        // Real-Time Notification to Hospital Admin Desk
        if (doctor.hospitalId) {
            try {
                await notifyAdminsAndVendor(
                    doctor.hospitalId,
                    'hospital',
                    "New Doctor Leave Request Pending Review",
                    `Dr. ${doctor.name} applied for leave from ${reqStart.format('DD MMM')} to ${reqEnd.format('DD MMM')}. Reason: "${reason.trim()}".`,
                    { doctorId: doctor._id.toString(), type: 'doctor_leave_request' }
                );
            } catch (e) {}
        }

        res.status(201).json({
            success: true,
            message: "Leave application submitted to Hospital Admin successfully for approval.",
            data: doctor.leaves[doctor.leaves.length - 1]
        });

    } catch (error) {
        console.error("Apply Doctor Leave Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Hospital Doctor Views Leave Applications History & Approval Status
// @route   GET /hospital-doctor/panel/leaves
// @access  Private (Hospital Doctor)
const getDoctorLeavesHistory = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const doctor = await Doctor.findById(doctorId).select('name leaves').lean();

        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found." });
        }

        const leaves = (doctor.leaves || []).sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));

        res.status(200).json({
            success: true,
            count: leaves.length,
            data: leaves
        });
    } catch (error) {
        console.error("Get Doctor Leaves History Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Hospital Doctor Blocks / Unblocks Specific OPD Time Slot for a Date with Reason
// @route   POST /hospital-doctor/panel/opd-slots/block-slot
// @access  Private (Hospital Doctor)
const blockOpdSlotWithReason = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { date, timeSlot, action = 'block', reason = 'Doctor Emergency / Rounds' } = req.body;

        if (!date || !timeSlot) {
            return res.status(400).json({ 
                success: false, 
                message: "date ('YYYY-MM-DD') and timeSlot (e.g. '11:00 AM') are required." 
            });
        }

        const cleanDate = moment(date).format('YYYY-MM-DD');
        const cleanSlot = String(timeSlot).trim();

        let availability = await Availability.findOne({ vendorId: doctorId, vendorType: 'Doctor' });
        if (!availability) {
            availability = await Availability.create({
                vendorId: doctorId,
                vendorType: 'Doctor',
                blockedSlotsWithReason: [],
                unavailableSlots: []
            });
        }

        if (action === 'block') {
            // Remove previous duplicate if present for this exact date & slot
            availability.blockedSlotsWithReason = (availability.blockedSlotsWithReason || []).filter(
                b => !(b.date === cleanDate && b.time === cleanSlot)
            );

            availability.blockedSlotsWithReason.push({
                date: cleanDate,
                time: cleanSlot,
                reason: String(reason).trim(),
                blockedAt: new Date()
            });

            // Also keep legacy unavailableSlots synced
            if (!availability.unavailableSlots.includes(cleanSlot)) {
                availability.unavailableSlots.push(cleanSlot);
            }
        } else {
            // Unblock
            availability.blockedSlotsWithReason = (availability.blockedSlotsWithReason || []).filter(
                b => !(b.date === cleanDate && b.time === cleanSlot)
            );
            availability.unavailableSlots = (availability.unavailableSlots || []).filter(s => s !== cleanSlot);
        }

        await availability.save();

        res.status(200).json({
            success: true,
            message: `OPD Slot '${cleanSlot}' for date ${cleanDate} has been ${action === 'block' ? 'Blocked' : 'Unblocked'}.`,
            data: availability.blockedSlotsWithReason
        });

    } catch (error) {
        console.error("Block OPD Slot Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// @desc    Hospital Doctor Reschedules OPD Appointment to Another Date/Slot with Clinical Reason
// @route   POST /hospital-doctor/panel/opd/reschedule
// @access  Private (Hospital Doctor)
const doctorRescheduleOpdAppointment = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { appointmentId, newDate, newTimeSlot, reason } = req.body;

        if (!appointmentId || !newDate || !newTimeSlot || !reason) {
            return res.status(400).json({
                success: false,
                message: "appointmentId, newDate, newTimeSlot, and explanation reason are mandatory."
            });
        }

        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const query = {
            doctorId,
            bookingType: 'OPD',
            ...(isObjectId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(query).populate('userId', 'name phone fcmToken');
        if (!appointment) {
            return res.status(404).json({ success: false, message: "OPD Appointment not found." });
        }

        if (['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital'].includes(appointment.status)) {
            return res.status(400).json({ success: false, message: `Cannot reschedule appointment in '${appointment.status}' state.` });
        }

        const targetDate = moment(newDate).startOf('day').toDate();
        const endOfDay = moment(newDate).endOf('day').toDate();

        // Recalculate sequential OPD token number for the new date
        const newDayTokensCount = await Appointment.countDocuments({
            hospitalId: appointment.hospitalId,
            doctorId,
            bookingType: 'OPD',
            appointmentDate: { $gte: targetDate, $lte: endOfDay },
            status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital'] }
        });
        const newTokenNumber = newDayTokensCount + 1;

        appointment.appointmentDate = targetDate;
        appointment.appointmentTime = newTimeSlot;
        appointment.tokenNumber = newTokenNumber;
        appointment.rescheduleReason = String(reason).trim();
        appointment.rescheduleCount = (appointment.rescheduleCount || 0) + 1;
        appointment.status = 'Rescheduled';

        appointment.treatmentHistory.push({
            action: 'Transfer-Initiated',
            notes: `Doctor Rescheduled to ${moment(newDate).format('YYYY-MM-DD')} at ${newTimeSlot}. Reason: "${reason.trim()}". New Token #${newTokenNumber}`,
            timestamp: new Date()
        });

        await appointment.save();

        // Real-Time Notification to Patient
        if (appointment.userId) {
            try {
                await sendPushNotification(
                    appointment.userId._id,
                    'user',
                    "OPD Appointment Rescheduled by Doctor",
                    `Dr. ${req.user.name || 'Doctor'} rescheduled your appointment to ${moment(newDate).format('DD MMM')} at ${newTimeSlot}. Your new Token is #${newTokenNumber}. Reason: "${reason.trim()}"`,
                    { appointmentId: appointment._id.toString(), type: 'opd_doctor_rescheduled', tokenNumber: newTokenNumber }
                );
            } catch (e) {}
        }

        res.status(200).json({
            success: true,
            message: `OPD Appointment successfully rescheduled. New Token is #${newTokenNumber}. Patient notified.`,
            tokenNumber: newTokenNumber,
            data: appointment
        });

    } catch (error) {
        console.error("Doctor Reschedule OPD Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Hospital Doctor Finishes OPD Consultation (Marks Completed, Advances Token Queue & Unlocks Wallet Revenue)
// @route   PATCH /hospital-doctor/panel/opd/complete-consultation/:appointmentId
// @access  Private (Hospital Doctor)
const completeOpdConsultation = async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const doctorId = req.user.id;
        const { consultationNotes, advice } = req.body;

        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const query = {
            doctorId,
            bookingType: 'OPD',
            ...(isObjectId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(query).populate('userId', 'name phone fcmToken');
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Active OPD consultation record not found for this doctor." });
        }

        if (appointment.status === 'Completed') {
            return res.status(400).json({ success: false, message: "This consultation is already marked as Completed." });
        }

        const now = new Date();
        appointment.status = 'Completed';
        
        if (!appointment.clinicalSummary) appointment.clinicalSummary = {};
        appointment.clinicalSummary.dischargedAt = now;
        
        if (consultationNotes && consultationNotes.trim() !== '') {
            appointment.clinicalSummary.treatmentResult = consultationNotes.trim();
        }
        if (advice && advice.trim() !== '') {
            appointment.clinicalSummary.dischargeNote = advice.trim();
        }

        // Close treatment history duration tracking
        if (Array.isArray(appointment.treatmentHistory) && appointment.treatmentHistory.length > 0) {
            const currentShift = appointment.treatmentHistory[appointment.treatmentHistory.length - 1];
            if (currentShift && !currentShift.endTime) {
                currentShift.endTime = now;
                const diffMinutes = Math.round((now - new Date(currentShift.startTime || currentShift.timestamp)) / 60000);
                currentShift.durationDisplay = `${diffMinutes} mins`;
            }
        }

        await appointment.save();

        // Push alert to Patient that OPD consultation is done
        if (appointment.userId) {
            try {
                await sendPushNotification(
                    appointment.userId._id,
                    'user',
                    `Consultation Completed (Token #${appointment.tokenNumber || '1'})`,
                    `Your consultation with Dr. ${req.user.name} is completed. Thank you for visiting!`,
                    { appointmentId: appointment._id.toString(), type: 'opd_consultation_completed' }
                );
            } catch (e) {}
        }

        res.status(200).json({
            success: true,
            message: `Consultation completed for Token #${appointment.tokenNumber || '1'}. Next token is ready.`,
            tokenNumber: appointment.tokenNumber,
            status: appointment.status,
            data: appointment
        });

    } catch (error) {
        console.error("Complete OPD Consultation Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// @desc    Get All Wards and Available Beds in Hospital for Doctor to Select
// @route   GET /hospital-doctor/panel/opd/available-beds
// @access  Private (Hospital Doctor)
const getDoctorAvailableWardsAndBeds = async (req, res) => {
    try {
        const doctor = await Doctor.findById(req.user.id).select('hospitalId');
        if (!doctor || !doctor.hospitalId) {
            return res.status(400).json({ success: false, message: "Doctor is not associated with any hospital." });
        }

        const now = new Date();

        // Lazy-Release: Auto-release any expired 30-min holds before returning bed list
        const expiredAppointments = await Appointment.find({
            hospitalId: doctor.hospitalId,
            admissionHoldExpiresAt: { $lt: now, $ne: null },
            paymentStatus: 'Pending',
            bedId: { $ne: null }
        });

        for (let appt of expiredAppointments) {
            await Bed.findByIdAndUpdate(appt.bedId, { $set: { status: 'Available' } });
            appt.admissionHoldExpiresAt = null;
            appt.status = 'Cancelled-By-Hospital';
            appt.cancellationDetails = {
                reason: "30-Minute admission payment window expired. Bed released automatically.",
                cancelledAt: now
            };
            await appt.save();
        }

        // Fetch Wards and their currently Available beds
        const wards = await Ward.find({ hospitalId: doctor.hospitalId, isActive: true }).lean();
        const availableBeds = await Bed.find({
            hospitalId: doctor.hospitalId,
            status: 'Available'
        }).populate('wardId', 'name type').sort({ bedNumber: 1 }).lean();

        // Group beds under respective wards
        const formattedWards = wards.map(ward => {
            const wardBeds = availableBeds.filter(b => b.wardId?._id?.toString() === ward._id.toString());
            return {
                wardId: ward._id,
                wardName: ward.name,
                wardType: ward.type,
                totalBeds: ward.totalBeds,
                availableBedsCount: wardBeds.length,
                beds: wardBeds.map(b => ({
                    bedId: b._id,
                    bedNumber: b.bedNumber,
                    pricePerDay: b.pricePerDay,
                    isVentilatorAvailable: b.isVentilatorAvailable,
                    status: b.status
                }))
            };
        });

        res.status(200).json({
            success: true,
            totalAvailableBeds: availableBeds.length,
            data: formattedWards
        });

    } catch (error) {
        console.error("Get Available Beds Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Doctor Creates Separate IPD Bed Booking with 30-Min Hold (With duplicate hold & bed switch protection)
// @route   POST /hospital-doctor/panel/opd/initiate-admission
// @access  Private (Hospital Doctor)
const initiateOpdToIpdAdmission = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { opdAppointmentId, bedId, admissionReason, triageLevel = 'Emergency', initialStayDays = 1 } = req.body;

        if (!opdAppointmentId || !bedId) {
            return res.status(400).json({ success: false, message: "opdAppointmentId and bedId are required." });
        }

        // 1. Fetch and verify original OPD appointment
        const opdAppointment = await Appointment.findOne({ _id: opdAppointmentId, doctorId })
            .populate('userId', 'name phone fcmToken');

        if (!opdAppointment) {
            return res.status(404).json({ success: false, message: "Original OPD appointment not found or unauthorized." });
        }

        const now = new Date();

        // 2. DUPLICATE HOLD PROTECTION: If a bed is already held for this OPD appointment, release previous bed first
        const existingActiveHold = await Appointment.findOne({
            opdAppointmentId: opdAppointment._id,
            bookingType: 'Admission',
            status: 'Hospital-Pending',
            admissionHoldExpiresAt: { $gt: now },
            paymentStatus: 'Pending'
        });

        if (existingActiveHold) {
            // Release previous reserved bed immediately
            if (existingActiveHold.bedId) {
                await Bed.findByIdAndUpdate(existingActiveHold.bedId, { $set: { status: 'Available' } });
            }
            // Cancel previous pending admission ticket
            existingActiveHold.status = 'Cancelled-By-Hospital';
            existingActiveHold.admissionHoldExpiresAt = null;
            existingActiveHold.cancellationDetails = {
                reason: "Doctor re-assigned another bed. Previous reservation cancelled.",
                cancelledAt: now
            };
            await existingActiveHold.save();
        }

        // 3. Verify new target bed is available
        const targetBed = await Bed.findById(bedId).populate('wardId');
        if (!targetBed || targetBed.status !== 'Available') {
            return res.status(400).json({ success: false, message: "Selected bed is no longer available. Please select another bed." });
        }

        const holdDeadline = new Date(now.getTime() + 30 * 60 * 1000); // 30 Minutes countdown
        const days = Math.max(1, parseInt(initialStayDays) || 1);
        const bedDeposit = Number(targetBed.pricePerDay || 1000) * days;
        const wardTitle = targetBed.wardId?.name || "General Ward";

        // 4. Lock Bed status to 'Reserved'
        targetBed.status = 'Reserved';
        await targetBed.save();

        // 5. Mark OPD Consultation as Completed
        opdAppointment.status = 'Completed';
        if (!opdAppointment.clinicalSummary) opdAppointment.clinicalSummary = {};
        opdAppointment.clinicalSummary.treatmentResult = `Patient examined in OPD. Recommended for inpatient admission in ${wardTitle} (${targetBed.bedNumber}).`;
        opdAppointment.clinicalSummary.dischargedAt = now;
        await opdAppointment.save();

        // 6. CREATE BRAND NEW SEPARATE IPD BED ADMISSION
        const newAdmissionBookingId = `HKH-ADM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        const newAdmissionBooking = await Appointment.create({
            userId: opdAppointment.userId._id,
            hospitalId: opdAppointment.hospitalId,
            doctorId: doctorId,
            opdAppointmentId: opdAppointment._id, // Cross-link to original OPD
            bookingId: newAdmissionBookingId,
            bookingType: 'Admission',
            bedBookingType: triageLevel === 'Emergency' ? 'Emergency-Bed' : 'General-Bed',
            bedId: targetBed._id,
            bedNumber: targetBed.bedNumber,
            wardName: wardTitle,
            triageLevel: triageLevel,
            startDate: now,
            endDate: moment(now).add(days, 'days').toDate(),
            stayDuration: days,
            bookingReason: admissionReason || "Admitted following OPD consultation",
            admissionHoldExpiresAt: holdDeadline,
            status: 'Hospital-Pending',
            paymentStatus: 'Pending',
            paymentMethod: 'COD',
            totalAmount: bedDeposit,
            pricingBreakdown: {
                baseFee: bedDeposit,
                subtotal: bedDeposit,
                bookedDurationDays: days,
                depositPaidOnBooking: bedDeposit
            },
            patients: opdAppointment.patients || [{
                patientName: opdAppointment.userId.name,
                patientAge: 30,
                gender: "Male",
                relation: "Self"
            }],
            clinicalSummary: {
                vitals: opdAppointment.clinicalSummary?.vitals || {}, // Retain triage vitals
                admissionNote: `Admitted from OPD Consultation #${opdAppointment.bookingId}. Reason: ${admissionReason || 'Emergency inpatient care'}`
            },
            treatmentHistory: [{
                fromDoctorId: doctorId,
                toDoctorId: doctorId,
                action: 'Initial-Assignment',
                notes: `Bed admission initiated from OPD #${opdAppointment.bookingId}. 30-min deposit hold active.`,
                timestamp: now,
                startTime: now
            }]
        });

        // 7. Push alert to Patient App
        if (opdAppointment.userId) {
            try {
                await sendPushNotification(
                    opdAppointment.userId._id,
                    'user',
                    "Hospital Admission Ready",
                    `Dr. ${req.user.name} booked ${wardTitle} (${targetBed.bedNumber}) for you. Please pay deposit ₹${bedDeposit} within 30 minutes to confirm.`,
                    { 
                        appointmentId: newAdmissionBooking._id.toString(), 
                        bookingId: newAdmissionBookingId,
                        type: 'admission_payment_required',
                        expiresAt: holdDeadline.toISOString(),
                        depositAmount: String(bedDeposit)
                    }
                );
            } catch (e) {}
        }

        res.status(201).json({
            success: true,
            message: `Bed ${targetBed.bedNumber} held for 30 minutes. Separate Admission #${newAdmissionBookingId} created!`,
            opdStatus: "Completed",
            admissionBookingId: newAdmissionBookingId,
            admissionAppointmentId: newAdmissionBooking._id,
            bedDetails: {
                bedId: targetBed._id,
                bedNumber: targetBed.bedNumber,
                wardName: wardTitle,
                pricePerDay: targetBed.pricePerDay
            },
            depositPayable: bedDeposit,
            holdExpiresAt: holdDeadline,
            remainingSeconds: 1800,
            admissionData: newAdmissionBooking
        });

    } catch (error) {
        console.error("Initiate OPD to IPD Admission Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = { 
    getMyDoctorProfile,changeHospitalDoctorPassword,
    updateDoctorProfile,getLatestDoctorProfileRequest,
    getDoctorHistory,

    getPendingAdmissions,
    takeChargeOfAdmission ,
    rejectTransfer,

    getSpecializations,
    getDocDashboard, getAssignedCases,
    getPrescriptionsByAppointment,
    deletePrescriptionById,
    getRawDischargeSummary,
    getPatientDetails, 
    processPrescription, transferPatient, acceptTransfer,
     getHospitalColleagues,
    submitDischargeSummary,verifyDischargeSheet,uploadPatientReports, updateDutyStatus, getMedicineList, updateClinicalSummary,

    requestBedsideSpecialist,respondToBedsideRequest,startSpecialistCare,submitSpecialistFeedback,getCollaborativeMedications,completeSpecialistCare,
    getPrintableDischargeSummary,
    doctorSelfAssignCase,addPrimaryClinicalLog,addActiveMedication,stopActiveMedication,
    // opd settings
    getDoctorOpdSettings,updateDoctorOpdSettings,startOpdConsultation,
    markOpdNoShow,toggleDoctorOpdSlotBlock,
    applyDoctorLeave,
    getDoctorLeavesHistory,
    blockOpdSlotWithReason,
    doctorRescheduleOpdAppointment,
    completeOpdConsultation,
    getDoctorAvailableWardsAndBeds,
    initiateOpdToIpdAdmission
};