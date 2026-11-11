// controllers/hospital/Doctor/hosDocPanel.js

const Doctor = require('../../../models/Doctor');
const Appointment = require('../../../models/Appointment');
const Specialization = require('../../../models/Specialization');
const Prescription = require('../../../models/Prescription');
const Availability = require('../../../models/Availability'); 
const User = require('../../../models/User');
const Coupon = require('../../../models/Coupon'); 
const DeliveryCharge = require('../../../models/DeliveryCharge'); 
const Insurance = require('../../../models/Insurance');
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
const { syncHospitalWardAndBedCapacity,generateUniqueOrderCode } = require('../../../utils/helpers');


// Helper: Calculate human-readable shift duration
const formatDocShiftDuration = (startTime, endTime = new Date()) => {
    if (!startTime) return "0 mins";
    const diffMs = Math.max(0, new Date(endTime).getTime() - new Date(startTime).getTime());
    const totalMinutes = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const mins = totalMinutes % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours} hr${hours > 1 ? 's' : ''}`);
    parts.push(`${mins} min${mins !== 1 ? 's' : ''}`);
    return parts.join(' ');
};

// Helper: Enrich treatmentHistory for Doctor Panel
const enrichDocPanelHistory = (historyArray = [], appointmentStatus = 'Pending') => {
    const now = new Date();
    const isCaseClosed = ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital', 'No-Show'].includes(appointmentStatus);

    return (historyArray || []).map((item, index) => {
        const assignedTime = item.assignedAt || item.startTime || item.timestamp;
        const acceptedTime = item.acceptedAt || null;
        const endedTime = item.endTime || null;
        const status = item.acceptanceStatus || 'Pending-Acceptance';
        const isLastEntry = index === historyArray.length - 1;

        let computedUnacceptedWait = item.unacceptedWaitDuration || "";
        let computedActiveDuty = "";
        let liveStatusLabel = item.durationDisplay || "";

        if (status === 'Pending-Acceptance') {
            if (!endedTime && !isCaseClosed && isLastEntry) {
                computedUnacceptedWait = formatDocShiftDuration(assignedTime, now);
                liveStatusLabel = `Unaccepted for ${computedUnacceptedWait} (Awaiting Acceptance)`;
            } else {
                computedUnacceptedWait = item.unacceptedWaitDuration || formatDocShiftDuration(assignedTime, endedTime || now);
                liveStatusLabel = `Did Not Accept for ${computedUnacceptedWait}`;
            }
        } else if (status === 'Unaccepted-Reassigned') {
            computedUnacceptedWait = item.unacceptedWaitDuration || formatDocShiftDuration(assignedTime, endedTime || now);
            liveStatusLabel = item.durationDisplay || `Did Not Accept for ${computedUnacceptedWait} (Reassigned)`;
        } else if (status === 'Rejected-By-Doctor') {
            computedUnacceptedWait = item.unacceptedWaitDuration || formatDocShiftDuration(assignedTime, endedTime || now);
            liveStatusLabel = item.durationDisplay || `Rejected after ${computedUnacceptedWait}`;
        } else if (status === 'Accepted' || status === 'Replaced-After-Acceptance' || status === 'Completed') {
            const dutyStart = acceptedTime || assignedTime;
            if (!endedTime && !isCaseClosed && isLastEntry) {
                computedActiveDuty = formatDocShiftDuration(dutyStart, now);
                liveStatusLabel = `${computedActiveDuty} (Active Duty)`;
            } else {
                computedActiveDuty = formatDocShiftDuration(dutyStart, endedTime || now);
                liveStatusLabel = item.durationDisplay || `${computedActiveDuty} (Shift Completed)`;
            }
        }

        return {
            ...item,
            attemptNumber: index + 1,
            fromDoctorName: item.fromDoctorId?.name || null,
            toDoctorName: item.toDoctorId?.name || "Assigned Doctor",
            toDoctorSpeciality: item.toDoctorId?.speciality || "",
            assignmentSource: item.assignmentSource || 'Hospital-Admin',
            acceptanceStatus: status,
            assignedAt: assignedTime,
            acceptedAt: acceptedTime,
            endedAt: endedTime,
            unacceptedWaitDuration: computedUnacceptedWait,
            activeDutyDuration: computedActiveDuty,
            isCurrentlyActive: Boolean(!endedTime && !isCaseClosed && isLastEntry && status === 'Accepted'),
            isAwaitingAcceptance: Boolean(!endedTime && !isCaseClosed && isLastEntry && status === 'Pending-Acceptance'),
            durationDisplay: liveStatusLabel
        };
    });
};


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





// @desc    Hospital Doctor Generates NMC-Formatted OPD Prescription (Hospital Tenancy & OPD Locked)
// @route   POST /hospital-doctor/panel/prescription/add
// @access  Private (Hospital Doctor Only)
const processPrescription = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const hospitalId = req.user.hospitalId; // Strict hospital tenancy resolution
        const appointmentId = req.body.appointmentId || req.query.appointmentId || req.params.appointmentId;

        if (!appointmentId) {
            return res.status(400).json({ success: false, message: "appointmentId is required." });
        }

        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const query = {
            doctorId,
            hospitalId, // Ensures doctor can only prescribe within their own hospital
            bookingType: 'OPD', // Strictly locked to OPD Consultations only
            ...(isObjectId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(query).populate('userId', 'name phone fcmToken');
        if (!appointment) {
            return res.status(404).json({ 
                success: false, 
                message: "Active OPD appointment record not found or access denied for this hospital doctor." 
            });
        }

        const {
            diagnosis,
            medicines,
            advice,
            chiefComplaints,
            advisedInvestigations,
            specialInstructions,
            nextAppointment,
            vitals
        } = req.body;

        // 1. SAFE PARSER: NMC Medicines Queue Array
        let rawMedicinesList = [];
        if (typeof medicines === 'string') {
            try {
                rawMedicinesList = JSON.parse(medicines);
            } catch (e) {
                rawMedicinesList = [];
            }
        } else if (Array.isArray(medicines)) {
            rawMedicinesList = medicines;
        }

        if (!rawMedicinesList || rawMedicinesList.length === 0) {
            return res.status(400).json({ success: false, message: "At least one medicine item is required in the prescription formulation queue." });
        }

        // Map NMC formulation fields exactly matching frontend UI design
        const parsedMedicines = rawMedicinesList.map(item => {
            const medName = String(item.name || item.medicineName || "Prescribed Medicine").trim();
            const strengthVal = String(item.strength || "").trim();
            const freqVal = String(item.frequency || "q.d.").trim();
            const intervalVal = String(item.doseInterval || item.dose || "1-0-0").trim();
            const durationVal = String(item.duration || "5 days").trim();
            const qtyVal = String(item.dispenseQuantity || "10 Tablets").trim();
            const timingVal = String(item.administrationTiming || item.instructions || "p.c. (After meals)").trim();

            return {
                name: medName,
                isCustomGeneric: Boolean(item.isCustomGeneric === true || item.isCustomGeneric === 'true'),
                genericComposition: String(item.genericComposition || "").trim(),
                strength: strengthVal,
                frequency: freqVal,
                doseInterval: intervalVal,
                duration: durationVal,
                dispenseQuantity: qtyVal,
                administrationTiming: timingVal,
                instructions: timingVal,
                dose: intervalVal, // Backward compatibility
                time: intervalVal, // Backward compatibility
                dosage: strengthVal // Backward compatibility
            };
        });

        // 2. SAFE PARSER: Diagnosis Array
        let parsedDiagnosis = [];
        if (typeof diagnosis === 'string') {
            try {
                const parsed = JSON.parse(diagnosis);
                parsedDiagnosis = Array.isArray(parsed) ? parsed : [parsed];
            } catch (e) {
                parsedDiagnosis = diagnosis.split(',').map(d => d.trim()).filter(Boolean);
            }
        } else if (Array.isArray(diagnosis)) {
            parsedDiagnosis = diagnosis;
        }

        // 3. SAFE PARSER: Vitals (Without schema crash)
        const parseVitalsSafely = (rawVitals, existing = {}) => {
            if (!rawVitals || rawVitals === 'undefined' || rawVitals === 'null' || rawVitals === '') {
                return existing && typeof existing === 'object' ? existing : {};
            }
            if (typeof rawVitals === 'object' && rawVitals !== null) {
                return {
                    bp: rawVitals.bp ? String(rawVitals.bp).trim() : (existing?.bp || ""),
                    pulse: rawVitals.pulse ? String(rawVitals.pulse).trim() : (existing?.pulse || ""),
                    temp: rawVitals.temp ? String(rawVitals.temp).trim() : (existing?.temp || ""),
                    spo2: rawVitals.spo2 ? String(rawVitals.spo2).trim() : (existing?.spo2 || "")
                };
            }
            if (typeof rawVitals === 'string') {
                try {
                    const parsed = JSON.parse(rawVitals);
                    if (parsed && typeof parsed === 'object') {
                        return {
                            bp: parsed.bp ? String(parsed.bp).trim() : (existing?.bp || ""),
                            pulse: parsed.pulse ? String(parsed.pulse).trim() : (existing?.pulse || ""),
                            temp: parsed.temp ? String(parsed.temp).trim() : (existing?.temp || ""),
                            spo2: parsed.spo2 ? String(parsed.spo2).trim() : (existing?.spo2 || "")
                        };
                    }
                } catch (e) {
                    return existing && typeof existing === 'object' ? existing : {};
                }
            }
            return existing && typeof existing === 'object' ? existing : {};
        };

        const safeVitals = parseVitalsSafely(vitals, appointment.clinicalSummary?.vitals);

        // 4. File uploads
        let prescriptionPdfPath = null;
        let dietPlanPdfPath = null;

        if (req.files) {
            if (req.files.prescriptionPdf && req.files.prescriptionPdf[0]) {
                prescriptionPdfPath = `/uploads/doctor_prescriptions/${req.files.prescriptionPdf[0].filename}`;
            }
            if (req.files.dietPlanPdf && req.files.dietPlanPdf[0]) {
                dietPlanPdfPath = `/uploads/diet_plans/${req.files.dietPlanPdf[0].filename}`;
            }
        }

        // 5. Create or Update Digital Prescription Document
        const newPrescription = await Prescription.create({
            appointmentId: appointment._id,
            doctorId: doctorId,
            userId: appointment.userId._id,
            chiefComplaints: chiefComplaints || appointment.clinicalSummary?.chiefComplaint || "",
            diagnosis: parsedDiagnosis,
            medicines: parsedMedicines,
            vitals: safeVitals,
            advisedInvestigations: advisedInvestigations || "None",
            adviceGiven: advice || "",
            specialInstructions: specialInstructions || "",
            nextAppointment: nextAppointment || "",
            pdfUrl: prescriptionPdfPath,
            dietPlanPdf: dietPlanPdfPath
        });

        // 6. Complete the OPD Encounter & Update Clinical Summary
        const now = new Date();
        appointment.status = 'Completed'; // Completing OPD consultation advances queue & syncs wallet

        if (!appointment.clinicalSummary) appointment.clinicalSummary = {};
        appointment.clinicalSummary.diagnosis = parsedDiagnosis.join(', ');
        appointment.clinicalSummary.treatmentResult = advice || "NMC Formulation prescription generated.";
        appointment.clinicalSummary.vitals = safeVitals;
        appointment.clinicalSummary.dischargedAt = now;

        if (prescriptionPdfPath) {
            appointment.clinicalSummary.dischargeSummaryPdf = prescriptionPdfPath;
        }

        await appointment.save();

        // 7. Send Push Notification to Patient
        if (appointment.userId) {
            try {
                await sendPushNotification(
                    appointment.userId._id,
                    'user',
                    "Prescription Generated 📄",
                    `Dr. ${req.user.name} has added your prescription (${parsedMedicines.length} medicine(s)). Tap to view.`,
                    { appointmentId: appointment._id.toString(), type: 'prescription_added' }
                );
            } catch (e) {}
        }

        res.status(200).json({
            success: true,
            message: `NMC Prescription generated successfully for Token #${appointment.tokenNumber || '1'}. Consultation marked Completed.`,
            tokenNumber: appointment.tokenNumber,
            appointmentStatus: appointment.status,
            prescriptionId: newPrescription._id,
            data: {
                prescription: newPrescription,
                appointment: {
                    id: appointment._id,
                    bookingId: appointment.bookingId,
                    tokenNumber: appointment.tokenNumber,
                    status: appointment.status,
                    completedAt: now
                }
            }
        });

    } catch (error) {
        console.error("Process Prescription Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. INITIATE PATIENT HANDOVER / TRANSFER TO COLLEAGUE
// Endpoint: POST /hospital-doctor/panel/case/transfer
const transferPatient = async (req, res) => {
    try {
        const fromDoctorId = req.user.id;
        const { appointmentId, toDoctorId, reason, priority } = req.body;

        if (!appointmentId || !toDoctorId) {
            return res.status(400).json({ success: false, message: "appointmentId and toDoctorId are required." });
        }

        const isObjId = mongoose.isValidObjectId(appointmentId);
        const query = {
            doctorId: fromDoctorId,
            ...(isObjId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const [appointment, targetDoctor] = await Promise.all([
            Appointment.findOne(query),
            Doctor.findById(toDoctorId).select('name speciality hospitalId').lean()
        ]);

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Active case not found under your care." });
        }
        if (!targetDoctor) {
            return res.status(404).json({ success: false, message: "Target colleague doctor not found." });
        }

        const now = new Date();
        appointment.pendingDoctorId = targetDoctor._id;

        if (!Array.isArray(appointment.treatmentHistory)) {
            appointment.treatmentHistory = [];
        }

        appointment.treatmentHistory.push({
            fromDoctorId: fromDoctorId,
            toDoctorId: targetDoctor._id,
            action: 'Transfer-Initiated',
            assignmentSource: 'Colleague-Handover',
            acceptanceStatus: 'Pending-Acceptance',
            assignedAt: now,
            acceptedAt: null,
            unacceptedWaitDuration: "",
            notes: reason
                ? `Handover requested to Dr. ${targetDoctor.name} (${priority || 'Routine'}). Note: ${reason}`
                : `Shift handover requested to Dr. ${targetDoctor.name}.`,
            timestamp: now,
            startTime: now,
            endTime: null,
            durationDisplay: "Awaiting Handover Acceptance"
        });

        await appointment.save();

        Promise.allSettled([
            sendPushNotification(
                targetDoctor._id,
                'doctor',
                "🔄 Incoming Patient Handover Request",
                `Dr. ${req.user.name} requested a case handover for booking #${appointment.bookingId} (Bed: ${appointment.bedNumber || 'IPD'}).`,
                { appointmentId: String(appointment._id), type: 'HANDOVER_REQUEST' }
            ),
            appointment.hospitalId ? sendPushNotification(
                appointment.hospitalId,
                'hospital',
                "🔄 Doctor Shift Handover Initiated",
                `Dr. ${req.user.name} initiated handover to Dr. ${targetDoctor.name} for case #${appointment.bookingId}.`,
                { appointmentId: String(appointment._id), type: 'HANDOVER_INITIATED' }
            ) : Promise.resolve()
        ]);

        return res.status(200).json({
            success: true,
            message: `Handover request sent to Dr. ${targetDoctor.name}.`,
            data: appointment
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};



// 4. ACCEPT PATIENT HANDOVER (Closes Previous Shift & Marks Transfer Accepted)
// Endpoint: POST /hospital-doctor/panel/case/accept-transfer
const acceptTransfer = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { appointmentId, notes } = req.body;

        if (!appointmentId) {
            return res.status(400).json({ success: false, message: "appointmentId is required." });
        }

        const isObjId = mongoose.isValidObjectId(appointmentId);
        const query = {
            pendingDoctorId: doctorId,
            ...(isObjId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(query).populate('doctorId', 'name speciality');
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Pending handover request not found for you." });
        }

        const now = new Date();
        const previousDoctorId = appointment.doctorId?._id || appointment.doctorId || null;
        const previousDoctorName = appointment.doctorId?.name || "Previous Doctor";

        if (!Array.isArray(appointment.treatmentHistory)) {
            appointment.treatmentHistory = [];
        }

        // Close previous doctor's active shift AND update the pending Transfer-Initiated log
        let updatedExistingTransferLog = false;
        for (let i = appointment.treatmentHistory.length - 1; i >= 0; i--) {
            const logItem = appointment.treatmentHistory[i];
            if (!logItem) continue;

            if (logItem.action === 'Transfer-Initiated' && String(logItem.toDoctorId) === String(doctorId) && !logItem.acceptedAt) {
                const waitStr = formatDocShiftDuration(logItem.assignedAt || logItem.timestamp, now);
                logItem.action = 'Transfer-Accepted';
                logItem.acceptanceStatus = 'Accepted';
                logItem.acceptedAt = now;
                logItem.unacceptedWaitDuration = waitStr;
                logItem.durationDisplay = "Active Duty";
                logItem.notes = notes
                    ? `${logItem.notes} | [Accepted by Dr. ${req.user.name} after ${waitStr}: ${notes}]`
                    : `${logItem.notes} | [Handover accepted by Dr. ${req.user.name} after ${waitStr}]`;
                updatedExistingTransferLog = true;
            } else if (!logItem.endTime && String(logItem.toDoctorId) !== String(doctorId)) {
                logItem.endTime = now;
                const startRef = logItem.acceptedAt || logItem.startTime || logItem.timestamp;
                logItem.acceptanceStatus = 'Completed';
                logItem.durationDisplay = `${formatDocShiftDuration(startRef, now)} (Handed over to Dr. ${req.user.name})`;
            }
        }

        if (!updatedExistingTransferLog) {
            appointment.treatmentHistory.push({
                fromDoctorId: previousDoctorId,
                toDoctorId: doctorId,
                action: 'Transfer-Accepted',
                assignmentSource: 'Colleague-Handover',
                acceptanceStatus: 'Accepted',
                assignedAt: now,
                acceptedAt: now,
                unacceptedWaitDuration: "0 mins",
                notes: notes || `Handover accepted by Dr. ${req.user.name} from Dr. ${previousDoctorName}.`,
                timestamp: now,
                startTime: now,
                endTime: null,
                durationDisplay: "Active Duty"
            });
        }

        appointment.doctorId = doctorId;
        appointment.pendingDoctorId = null;
        appointment.status = 'In-Progress';

        await appointment.save();

        Promise.allSettled([
            previousDoctorId ? sendPushNotification(
                previousDoctorId,
                'doctor',
                "✅ Handover Accepted",
                `Dr. ${req.user.name} accepted your handover for case #${appointment.bookingId}.`,
                { appointmentId: String(appointment._id), type: 'HANDOVER_ACCEPTED' }
            ) : Promise.resolve(),
            appointment.hospitalId ? sendPushNotification(
                appointment.hospitalId,
                'hospital',
                "✅ Shift Handover Completed",
                `Dr. ${req.user.name} accepted handover from Dr. ${previousDoctorName} for case #${appointment.bookingId}.`,
                { appointmentId: String(appointment._id), type: 'HANDOVER_ACCEPTED' }
            ) : Promise.resolve(),
            appointment.userId ? sendPushNotification(
                appointment.userId,
                'user',
                "👨‍⚕️ Attending Doctor Shift Updated",
                `Dr. ${req.user.name} (${req.user.speciality || 'Specialist'}) has taken over your care from Dr. ${previousDoctorName}.`,
                { appointmentId: String(appointment._id), type: 'DOCTOR_SHIFT_UPDATED' }
            ) : Promise.resolve()
        ]);

        return res.status(200).json({
            success: true,
            message: "Handover accepted successfully. You are now the lead attending doctor.",
            data: appointment
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};


// 5. REJECT PATIENT HANDOVER / ASSIGNMENT (Logs Rejection Reason & Wait Duration)
// Endpoint: POST /hospital-doctor/panel/case/reject-transfer
const rejectTransfer = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { appointmentId, reason } = req.body;

        if (!appointmentId) {
            return res.status(400).json({ success: false, message: "appointmentId is required." });
        }

        const isObjId = mongoose.isValidObjectId(appointmentId);
        const query = {
            $or: [{ pendingDoctorId: doctorId }, { doctorId: doctorId }],
            ...(isObjId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(query);
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Case assignment/transfer request not found." });
        }

        const now = new Date();
        const rejectReasonStr = reason ? String(reason).trim() : "Doctor busy in emergency / unavailable";

        if (Array.isArray(appointment.treatmentHistory) && appointment.treatmentHistory.length > 0) {
            for (let i = appointment.treatmentHistory.length - 1; i >= 0; i--) {
                const logItem = appointment.treatmentHistory[i];
                if (logItem && String(logItem.toDoctorId) === String(doctorId) && !logItem.endTime) {
                    const waitStr = formatDocShiftDuration(logItem.assignedAt || logItem.timestamp, now);
                    logItem.action = 'Transfer-Rejected';
                    logItem.acceptanceStatus = 'Rejected-By-Doctor';
                    logItem.endTime = now;
                    logItem.unacceptedWaitDuration = waitStr;
                    logItem.rejectionReason = rejectReasonStr;
                    logItem.durationDisplay = `Declined after ${waitStr} (Reason: ${rejectReasonStr})`;
                    logItem.notes = `${logItem.notes || ''} | [Declined by Dr. ${req.user.name} after ${waitStr}: ${rejectReasonStr}]`;
                    break;
                }
            }
        }

        if (String(appointment.pendingDoctorId) === String(doctorId)) {
            appointment.pendingDoctorId = null;
        } else if (String(appointment.doctorId) === String(doctorId)) {
            appointment.doctorId = null;
        }

        await appointment.save();

        if (appointment.hospitalId) {
            sendPushNotification(
                appointment.hospitalId,
                'hospital',
                "⚠️ Doctor Declined Case Assignment",
                `Dr. ${req.user.name} declined case #${appointment.bookingId}. Reason: "${rejectReasonStr}". Please assign another doctor.`,
                { appointmentId: String(appointment._id), type: 'DOCTOR_REJECTED_CASE' }
            ).catch(() => {});
        }

        return res.status(200).json({
            success: true,
            message: "Case assignment/handover declined and logged.",
            data: appointment
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
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

// @desc    Doctor Submits Discharge Summary & Closes Active Treatment Shift Timer
// @route   POST /hospital-doctor/panel/case/discharge-summary
// @access  Private (Hospital-Doctor)
const submitDischargeSummary = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const {
            appointmentId,
            diagnosis,
            investigation,
            treatmentResult,
            dischargeNote,
            chiefComplaint,
            dateOfSurgery,
            conditionDuringAdmission,
            conditionDuringDischarge,
            vitals
        } = req.body;

        if (!appointmentId) {
            return res.status(400).json({
                success: false,
                message: "appointmentId is required to submit discharge summary."
            });
        }

        const isObjId = mongoose.isValidObjectId(appointmentId);
        const query = isObjId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() };

        const appointment = await Appointment.findOne(query);
        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Admission case not found."
            });
        }

        let parsedVitals = {};
        if (typeof vitals === 'string') {
            try { parsedVitals = JSON.parse(vitals); } catch (e) { parsedVitals = {}; }
        } else if (vitals && typeof vitals === 'object') {
            parsedVitals = vitals;
        }

        // Handle uploaded files (dischargePdf and clinicalReports)
        const files = req.files || {};
        let dischargePdfPath = appointment.clinicalSummary?.dischargeSummaryPdf || null;
        let uploadedReportPaths = Array.isArray(appointment.clinicalSummary?.uploadedReports)
            ? [...appointment.clinicalSummary.uploadedReports]
            : [];

        if (Array.isArray(req.files)) {
            req.files.forEach(file => {
                uploadedReportPaths.push(`/uploads/doctor_reports/${file.filename}`);
            });
        } else {
            if (files.dischargePdf && files.dischargePdf[0]) {
                dischargePdfPath = `/uploads/hospital_discharges/${files.dischargePdf[0].filename}`;
            }
            if (files.clinicalReports && files.clinicalReports.length > 0) {
                const newReps = files.clinicalReports.map(f => `/uploads/doctor_reports/${f.filename}`);
                uploadedReportPaths.push(...newReps);
            }
        }

        const now = new Date();

        // Update clinicalSummary
        if (!appointment.clinicalSummary) appointment.clinicalSummary = {};
        if (diagnosis !== undefined) appointment.clinicalSummary.diagnosis = diagnosis;
        if (investigation !== undefined) appointment.clinicalSummary.investigation = investigation;
        if (treatmentResult !== undefined) appointment.clinicalSummary.treatmentResult = treatmentResult;
        if (dischargeNote !== undefined) appointment.clinicalSummary.dischargeNote = dischargeNote;
        if (chiefComplaint !== undefined) appointment.clinicalSummary.chiefComplaint = chiefComplaint;
        if (dateOfSurgery) appointment.clinicalSummary.dateOfSurgery = new Date(dateOfSurgery);
        if (conditionDuringAdmission !== undefined) appointment.clinicalSummary.conditionDuringAdmission = conditionDuringAdmission;
        if (conditionDuringDischarge !== undefined) appointment.clinicalSummary.conditionDuringDischarge = conditionDuringDischarge;
        if (dischargePdfPath) appointment.clinicalSummary.dischargeSummaryPdf = dischargePdfPath;
        appointment.clinicalSummary.uploadedReports = uploadedReportPaths;
        appointment.clinicalSummary.dischargedAt = now;

        if (Object.keys(parsedVitals).length > 0) {
            appointment.clinicalSummary.vitals = {
                bp: parsedVitals.bp || appointment.clinicalSummary.vitals?.bp || "",
                pulse: parsedVitals.pulse || appointment.clinicalSummary.vitals?.pulse || "",
                temp: parsedVitals.temp || appointment.clinicalSummary.vitals?.temp || "",
                spo2: parsedVitals.spo2 || appointment.clinicalSummary.vitals?.spo2 || ""
            };
        }

        // Close open shift timer in treatmentHistory and record Discharged action
        if (!Array.isArray(appointment.treatmentHistory)) {
            appointment.treatmentHistory = [];
        }

        if (appointment.treatmentHistory.length > 0) {
            const lastLog = appointment.treatmentHistory[appointment.treatmentHistory.length - 1];
            if (lastLog && !lastLog.endTime) {
                const startRef = lastLog.acceptedAt || lastLog.startTime || lastLog.timestamp;
                const totalDutyStr = formatDocShiftDuration(startRef, now);
                lastLog.endTime = now;
                lastLog.acceptanceStatus = 'Completed';
                lastLog.durationDisplay = `${totalDutyStr} (Completed & Discharged)`;
            }
        }

        appointment.treatmentHistory.push({
            fromDoctorId: doctorId,
            toDoctorId: doctorId,
            action: 'Discharged',
            assignmentSource: 'Hospital-Admin',
            acceptanceStatus: 'Completed',
            assignedAt: now,
            acceptedAt: now,
            endTime: now,
            unacceptedWaitDuration: "0 mins",
            durationDisplay: "Discharge Summary Submitted",
            notes: `Discharge summary submitted by Dr. ${req.user.name}. Diagnosis: ${diagnosis || 'Recorded'}. Ready for final billing clearance.`,
            timestamp: now,
            startTime: now
        });

        appointment.status = 'Discharge-Pending';
        await appointment.save();

        // Notify Hospital Admin & Patient
        Promise.allSettled([
            appointment.hospitalId ? sendPushNotification(
                appointment.hospitalId,
                'hospital',
                "📋 Discharge Summary Submitted by Doctor",
                `Dr. ${req.user.name} submitted discharge summary for case #${appointment.bookingId} (Bed: ${appointment.bedNumber || 'IPD'}). Ready for final bill settlement.`,
                { appointmentId: String(appointment._id), bookingId: String(appointment.bookingId), type: 'DISCHARGE_PENDING' }
            ) : Promise.resolve(),
            appointment.userId ? sendPushNotification(
                appointment.userId,
                'user',
                "📋 Discharge Summary Ready",
                `Dr. ${req.user.name} has prepared your discharge summary for booking #${appointment.bookingId}.`,
                { appointmentId: String(appointment._id), bookingId: String(appointment.bookingId), type: 'DISCHARGE_SUMMARY_READY' }
            ) : Promise.resolve()
        ]);

        return res.status(200).json({
            success: true,
            message: "Discharge summary & medical reports submitted successfully.",
            data: appointment
        });

    } catch (error) {
        console.error("Submit Discharge Summary Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
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

// @desc    Get Master Medicines Catalog for Doctor to Search & Auto-Fill Strength/Packaging
// @route   GET /hospital-doctor/panel/medicines
// @access  Private (Hospital Doctor)
const getMedicineList = async (req, res) => {
    try {
        const { search, page = 1, limit = 20 } = req.query;

        let query = {};
        if (search && search.trim() !== "") {
            query.$or = [
                { name: { $regex: search.trim(), $options: 'i' } },
                { salt_composition: { $regex: search.trim(), $options: 'i' } }
            ];
        }

        const skip = (Math.max(1, parseInt(page)) - 1) * Math.max(1, parseInt(limit));

        const medicines = await Medicine.find(query)
            .select('name salt_composition packaging mrp image_url')
            .limit(Math.max(1, parseInt(limit)))
            .skip(skip)
            .sort({ name: 1 })
            .lean();

        const formattedList = medicines.map(med => ({
            id: med._id,
            name: med.name,
            genericComposition: med.salt_composition || "",
            packaging: med.packaging || "10 Tablets",
            estimatedMrp: med.mrp || "0",
            imageUrl: Array.isArray(med.image_url) && med.image_url.length > 0 ? med.image_url[0] : null
        }));

        res.status(200).json({
            success: true,
            count: formattedList.length,
            data: formattedList
        });

    } catch (error) {
        console.error("Get Doctor Medicine List Error:", error);
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


// @desc    Get Prescription by Appointment ID (Enriched with Doctor & Hospital Header for Printing)
// @route   GET /hospital-doctor/panel/prescriptions/:appointmentId
// @access  Private (Hospital Doctor or Hospital Admin)
const getPrescriptionsByAppointment = async (req, res) => {
    try {
        const { appointmentId } = req.params;

        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const query = isObjectId ? { appointmentId } : { 'appointmentId.bookingId': appointmentId };

        const prescription = await Prescription.findOne(isObjectId ? { appointmentId } : {})
            .populate({
                path: 'appointmentId',
                select: 'bookingId tokenNumber appointmentDate appointmentTime status bookingType hospitalId',
                populate: {
                    path: 'hospitalId',
                    select: 'name address phone city hospitalImage'
                }
            })
            .populate('doctorId', 'name speciality qualification councilNumber department profileImage')
            .populate('userId', 'name phone gender dob age')
            .lean();

        if (!prescription) {
            return res.status(404).json({ success: false, message: "No prescription record found for this appointment." });
        }

        res.status(200).json({
            success: true,
            data: {
                ...prescription,
                hospitalHeader: prescription.appointmentId?.hospitalId || null,
                patientDetails: prescription.userId || null,
                doctorDetails: prescription.doctorId || null,
                medicinesCount: prescription.medicines ? prescription.medicines.length : 0
            }
        });

    } catch (error) {
        console.error("Get Prescription By Appointment Error:", error);
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

// 6. GET PATIENT DETAILS FOR DOCTOR PANEL (Full Populated Audit Trail)
// Endpoint: GET /hospital-doctor/panel/case-details/:id
// =========================================================================
const getPatientDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const isObjId = mongoose.isValidObjectId(id);
        const query = isObjId ? { _id: id } : { bookingId: String(id).trim() };

        const caseData = await Appointment.findOne(query)
            .populate('userId', 'name phone email profilePic gender dob bloodGroup height weight conditionStatus familyHistory')
            .populate('hospitalId', 'name address phone city state hospitalImage')
            .populate('doctorId', 'name speciality qualification phone profileImage department')
            .populate('pendingDoctorId', 'name speciality qualification phone profileImage department')
            .populate({
                path: 'bedId',
                select: 'bedNumber status pricePerDay isVentilatorAvailable wardId',
                populate: { path: 'wardId', select: 'name type' }
            })
            .populate('ambulanceId', 'name phone vehicleNumber vehicleType location driverInfo')
            .populate('specialServices.serviceId', 'serviceName price image description')
            .populate('treatmentHistory.fromDoctorId', 'name speciality profileImage department phone')
            .populate('treatmentHistory.toDoctorId', 'name speciality profileImage department phone')
            .populate('clinicalLogs.doctorId', 'name speciality profileImage department phone')
            .populate('bedsideCareTeam.doctorId', 'name speciality profileImage department phone')
            .populate('activeMedications.addedBy', 'name speciality profileImage')
            .lean();

        if (!caseData) {
            return res.status(404).json({ success: false, message: "Patient case record not found." });
        }

        const prescriptions = await Prescription.find({ appointmentId: caseData._id })
            .populate('doctorId', 'name speciality qualification signatureImage')
            .sort({ createdAt: -1 })
            .lean();

        const enrichedTreatmentHistory = enrichDocPanelHistory(caseData.treatmentHistory, caseData.status);

        const enrichedClinicalLogs = (caseData.clinicalLogs || []).map(log => ({
            ...log,
            doctorName: log.doctorId?.name || "Attending Doctor",
            doctorSpeciality: log.doctorId?.speciality || ""
        }));

        return res.status(200).json({
            success: true,
            data: {
                ...caseData,
                treatmentHistory: enrichedTreatmentHistory,
                clinicalLogs: enrichedClinicalLogs,
                prescriptions: prescriptions || []
            }
        });
    } catch (error) {
        console.error("Get Patient Details Error:", error);
        return res.status(500).json({ success: false, message: error.message });
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

// 1. TAKE CHARGE OF ADMISSION (Marks Pending Assignment as 'Accepted' with Response Time)
// Endpoint: POST /hospital-doctor/panel/case/take-charge
const takeChargeOfAdmission = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const hospitalId = req.user.hospitalId;
        const { appointmentId, caseId, bookingId, notes } = req.body;

        const targetId = appointmentId || caseId || bookingId;
        if (!targetId) {
            return res.status(400).json({ success: false, message: "appointmentId is required." });
        }

        const isObjId = mongoose.isValidObjectId(targetId);
        const query = {
            hospitalId,
            ...(isObjId ? { _id: targetId } : { bookingId: String(targetId).trim() })
        };

        const appointment = await Appointment.findOne(query);
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Admission case not found in your hospital." });
        }

        const now = new Date();
        if (!Array.isArray(appointment.treatmentHistory)) {
            appointment.treatmentHistory = [];
        }

        const lastLog = appointment.treatmentHistory.length > 0
            ? appointment.treatmentHistory[appointment.treatmentHistory.length - 1]
            : null;

        // CASE A: This doctor was already assigned (by User at booking or by Hospital Admin) and is now accepting
        if (lastLog && !lastLog.endTime && String(lastLog.toDoctorId) === String(doctorId) && lastLog.acceptanceStatus === 'Pending-Acceptance') {
            const assignedTime = lastLog.assignedAt || lastLog.startTime || lastLog.timestamp;
            const responseDelay = formatDocShiftDuration(assignedTime, now);

            lastLog.acceptanceStatus = 'Accepted';
            lastLog.acceptedAt = now;
            lastLog.unacceptedWaitDuration = responseDelay;
            lastLog.durationDisplay = "Active Duty";
            lastLog.notes = notes
                ? `${lastLog.notes} | [Accepted by Dr. ${req.user.name} after ${responseDelay}: ${notes}]`
                : `${lastLog.notes} | [Accepted by Dr. ${req.user.name} after ${responseDelay}]`;
        } else {
            // CASE B: Another doctor was pending/open, close their log first
            if (lastLog && !lastLog.endTime) {
                const prevAssigned = lastLog.assignedAt || lastLog.startTime || lastLog.timestamp;
                lastLog.endTime = now;
                if (lastLog.acceptanceStatus === 'Pending-Acceptance') {
                    const waitStr = formatDocShiftDuration(prevAssigned, now);
                    lastLog.acceptanceStatus = 'Unaccepted-Reassigned';
                    lastLog.unacceptedWaitDuration = waitStr;
                    lastLog.durationDisplay = `Did Not Accept for ${waitStr} (Taken over by Dr. ${req.user.name})`;
                } else {
                    lastLog.acceptanceStatus = 'Replaced-After-Acceptance';
                    lastLog.durationDisplay = formatDocShiftDuration(lastLog.acceptedAt || prevAssigned, now);
                }
            }

            // Push fresh Accepted log for this doctor
            appointment.treatmentHistory.push({
                fromDoctorId: appointment.doctorId || null,
                toDoctorId: doctorId,
                action: 'Initial-Assignment',
                assignmentSource: 'Doctor-Self-Assigned',
                acceptanceStatus: 'Accepted',
                assignedAt: now,
                acceptedAt: now,
                unacceptedWaitDuration: "0 mins (Instant)",
                notes: notes
                    ? String(notes).trim()
                    : `Dr. ${req.user.name} (${req.user.speciality || 'Specialist'}) took charge of the patient.`,
                timestamp: now,
                startTime: now,
                endTime: null,
                durationDisplay: "Active Duty"
            });
        }

        appointment.doctorId = doctorId;
        appointment.pendingDoctorId = null;
        if (['Pending', 'Hospital-Pending', 'Confirmed'].includes(appointment.status)) {
            appointment.status = 'In-Progress';
        }

        await appointment.save();

        Promise.allSettled([
            appointment.userId ? sendPushNotification(
                appointment.userId,
                'user',
                "👨‍⚕️ Doctor Accepted & Took Charge",
                `Dr. ${req.user.name} is now actively attending your admission case (#${appointment.bookingId}).`,
                { appointmentId: String(appointment._id), type: 'DOCTOR_TOOK_CHARGE' }
            ) : Promise.resolve(),
            hospitalId ? sendPushNotification(
                hospitalId,
                'hospital',
                "✅ Doctor Accepted Case",
                `Dr. ${req.user.name} accepted and took charge of case #${appointment.bookingId}.`,
                { appointmentId: String(appointment._id), type: 'DOCTOR_TOOK_CHARGE' }
            ) : Promise.resolve()
        ]);

        return res.status(200).json({
            success: true,
            message: "You have successfully accepted and taken charge of this patient.",
            data: appointment
        });
    } catch (error) {
        console.error("Take Charge Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// 2. DOCTOR SELF-ASSIGN CASE (Full Standalone Implementation)
// Endpoint: POST /hospital-doctor/panel/case/self-assign
// =========================================================================
const doctorSelfAssignCase = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const hospitalId = req.user.hospitalId;
        const { appointmentId, caseId, bookingId, notes } = req.body;

        const targetId = appointmentId || caseId || bookingId;
        if (!targetId) {
            return res.status(400).json({
                success: false,
                message: "appointmentId (or caseId / bookingId) is required to self-assign a case."
            });
        }

        const isObjId = mongoose.isValidObjectId(targetId);
        const query = {
            hospitalId,
            ...(isObjId ? { _id: targetId } : { bookingId: String(targetId).trim() })
        };

        const appointment = await Appointment.findOne(query);
        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Case record not found in your hospital."
            });
        }

        const now = new Date();
        if (!Array.isArray(appointment.treatmentHistory)) {
            appointment.treatmentHistory = [];
        }

        const lastLog = appointment.treatmentHistory.length > 0
            ? appointment.treatmentHistory[appointment.treatmentHistory.length - 1]
            : null;

        // If this doctor was already in Pending-Acceptance state, mark Accepted
        if (lastLog && !lastLog.endTime && String(lastLog.toDoctorId) === String(doctorId) && lastLog.acceptanceStatus === 'Pending-Acceptance') {
            const assignedTime = lastLog.assignedAt || lastLog.startTime || lastLog.timestamp;
            const responseDelay = formatDocShiftDuration(assignedTime, now);

            lastLog.acceptanceStatus = 'Accepted';
            lastLog.acceptedAt = now;
            lastLog.unacceptedWaitDuration = responseDelay;
            lastLog.durationDisplay = "Active Duty";
            lastLog.notes = `${lastLog.notes} | [Accepted by Dr. ${req.user.name} after ${responseDelay}]`;
        } else {
            if (lastLog && !lastLog.endTime) {
                const prevAssigned = lastLog.assignedAt || lastLog.startTime || lastLog.timestamp;
                lastLog.endTime = now;
                if (lastLog.acceptanceStatus === 'Pending-Acceptance') {
                    const waitStr = formatDocShiftDuration(prevAssigned, now);
                    lastLog.acceptanceStatus = 'Unaccepted-Reassigned';
                    lastLog.unacceptedWaitDuration = waitStr;
                    lastLog.durationDisplay = `Did Not Accept for ${waitStr} (Self-Assigned by Dr. ${req.user.name})`;
                } else {
                    lastLog.acceptanceStatus = 'Replaced-After-Acceptance';
                    lastLog.durationDisplay = formatDocShiftDuration(lastLog.acceptedAt || prevAssigned, now);
                }
            }

            appointment.treatmentHistory.push({
                fromDoctorId: appointment.doctorId || null,
                toDoctorId: doctorId,
                action: 'Initial-Assignment',
                assignmentSource: 'Doctor-Self-Assigned',
                acceptanceStatus: 'Accepted',
                assignedAt: now,
                acceptedAt: now,
                unacceptedWaitDuration: "0 mins (Instant)",
                notes: notes
                    ? String(notes).trim()
                    : `Dr. ${req.user.name} (${req.user.speciality || 'Specialist'}) self-assigned and took charge of the case.`,
                timestamp: now,
                startTime: now,
                endTime: null,
                durationDisplay: "Active Duty"
            });
        }

        appointment.doctorId = doctorId;
        appointment.pendingDoctorId = null;
        if (['Pending', 'Hospital-Pending', 'Confirmed'].includes(appointment.status)) {
            appointment.status = 'In-Progress';
        }

        await appointment.save();

        const populatedCase = await Appointment.findById(appointment._id)
            .populate('userId', 'name phone gender dob bloodGroup profilePic')
            .populate('doctorId', 'name speciality qualification phone profileImage department')
            .populate('treatmentHistory.fromDoctorId', 'name speciality profileImage department')
            .populate('treatmentHistory.toDoctorId', 'name speciality profileImage department')
            .lean();

        return res.status(200).json({
            success: true,
            message: `Case #${appointment.bookingId} self-assigned successfully to Dr. ${req.user.name}.`,
            data: {
                ...populatedCase,
                treatmentHistory: enrichDocPanelHistory(populatedCase.treatmentHistory, populatedCase.status)
            }
        });
    } catch (error) {
        console.error("Doctor Self Assign Case Error:", error);
        return res.status(500).json({ success: false, message: error.message });
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






// @desc    Hospital-Doctor Fetches Own OPD Settings, Weekly Shifts, Premium Slots & Blocked Slots (With Optional Date-wise Slot Grid)
// @route   GET /hospital-doctor/panel/opd-settings
// @access  Private (Hospital Doctor)
const getDoctorOpdSettings = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { date } = req.query; // Optional: ?date=YYYY-MM-DD

        // 1. Fetch Doctor Profile & Hospital Details
        const doctor = await Doctor.findById(doctorId)
            .populate('hospitalId', 'name city address hospitalImage')
            .select('name speciality fees slotDuration availability department leaves dutyStatus hospitalId')
            .lean();

        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor profile not found." });
        }

        // 2. Fetch Availability Configuration (Premium Slots, Unavailable Slots, Blocked Slots)
        const availabilityConfig = await Availability.findOne({ vendorId: doctor._id }).lean();

        // Standardize helper to format time
        const normalizeTo24H = (timeStr) => {
            if (!timeStr) return "";
            const clean = String(timeStr).trim();
            if (/^\d{1,2}:\d{2}$/.test(clean)) {
                const [h, m] = clean.split(':').map(Number);
                return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            }
            const parsed = moment(clean, ["hh:mm A", "h:mm A", "HH:mm", "H:mm", "hh:mma", "h:mma"]);
            return parsed.isValid() ? parsed.format("HH:mm") : clean;
        };

        const duration = Math.max(5, Number(doctor.slotDuration || 15));
        const baseFee = Number(doctor.fees?.clinic || 500);

        // Map Premium Slots
        const premiumSlots = (availabilityConfig?.premiumSlots || []).map(ps => ({
            time: ps.time,
            time24: normalizeTo24H(ps.time),
            extraFee: Number(ps.extraFee || 0),
            totalFee: baseFee + Number(ps.extraFee || 0)
        }));

        // Map Blocked Slots With Reasons
        const blockedSlotsWithReason = (availabilityConfig?.blockedSlotsWithReason || []).map(b => ({
            date: moment(b.date).format("YYYY-MM-DD"),
            time: b.time,
            time24: normalizeTo24H(b.time),
            reason: b.reason || "Doctor unavailable",
            blockedAt: b.blockedAt || null
        }));

        const responseData = {
            doctor: {
                id: doctor._id,
                name: doctor.name,
                speciality: doctor.speciality,
                dutyStatus: doctor.dutyStatus || "On Duty",
                cabinRoom: doctor.department?.roomNumber || "Cabin 1",
                baseOpdFee: baseFee,
                slotDurationMinutes: duration,
                hospital: {
                    id: doctor.hospitalId?._id,
                    name: doctor.hospitalId?.name || "Hospital",
                    city: doctor.hospitalId?.city || ""
                }
            },
            generalSchedule: {
                startTime: availabilityConfig?.startTime || "09:00",
                endTime: availabilityConfig?.endTime || "18:00",
                slotDurationMinutes: duration,
                weeklyAvailability: doctor.availability || []
            },
            premiumSlots,
            unavailableSlots: (availabilityConfig?.unavailableSlots || []).map(t => ({
                time: t,
                time24: normalizeTo24H(t)
            })),
            blockedSlotsWithReason,
            blockedDates: availabilityConfig?.blockedDates || [],
            approvedLeaves: (doctor.leaves || []).filter(l => l.status === 'Approved').map(l => ({
                startDate: moment(l.startDate).format("YYYY-MM-DD"),
                endDate: moment(l.endDate).format("YYYY-MM-DD"),
                reason: l.reason
            }))
        };

        // 3. OPTIONAL: If date query is provided, calculate the full day's live slots for doctor's view
        if (date && date.trim() !== "") {
            const targetDateStr = date.trim();
            const targetDate = moment(targetDateStr, "YYYY-MM-DD");

            if (targetDate.isValid()) {
                const dayName = targetDate.format('ddd');
                let shiftsToProcess = [];

                if (Array.isArray(doctor.availability) && doctor.availability.length > 0) {
                    const dayMatches = doctor.availability.filter(a => a.day === dayName && a.startTime && a.endTime);
                    if (dayMatches.length > 0) {
                        shiftsToProcess = dayMatches.map(s => ({
                            startTime: normalizeTo24H(s.startTime),
                            endTime: normalizeTo24H(s.endTime)
                        }));
                    }
                }

                if (shiftsToProcess.length === 0 && availabilityConfig && availabilityConfig.startTime && availabilityConfig.endTime) {
                    shiftsToProcess.push({
                        startTime: normalizeTo24H(availabilityConfig.startTime),
                        endTime: normalizeTo24H(availabilityConfig.endTime)
                    });
                }

                if (shiftsToProcess.length === 0) {
                    shiftsToProcess.push({ startTime: "09:00", endTime: "18:00" });
                }

                // Fetch day's appointments for doctor
                const dayStart = targetDate.clone().startOf('day').toDate();
                const dayEnd = targetDate.clone().endOf('day').toDate();

                const bookedAppointments = await Appointment.find({
                    doctorId: doctor._id,
                    bookingType: 'OPD',
                    status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending', 'Completed'] },
                    appointmentDate: { $gte: dayStart, $lte: dayEnd }
                }).select('appointmentTime tokenNumber status patients').lean();

                const bookedMap = {};
                bookedAppointments.forEach(b => {
                    const t24 = normalizeTo24H(b.appointmentTime);
                    bookedMap[t24] = {
                        tokenNumber: b.tokenNumber,
                        status: b.status,
                        patientName: b.patients?.[0]?.patientName || "Patient"
                    };
                });

                // Blocked reasons map for this specific day
                const dayBlockedReasonsMap = {};
                blockedSlotsWithReason.forEach(item => {
                    if (item.date === targetDateStr) {
                        dayBlockedReasonsMap[item.time24] = item.reason;
                    }
                });

                // Premium map
                const dayPremiumMap = {};
                premiumSlots.forEach(ps => {
                    dayPremiumMap[ps.time24] = ps.extraFee;
                });

                const nowIST = moment().utcOffset("+05:30");
                const isToday = targetDateStr === nowIST.format("YYYY-MM-DD");

                const daySlots = [];
                for (const shift of shiftsToProcess) {
                    const [startH, startM] = shift.startTime.split(':').map(Number);
                    const [endH, endM] = shift.endTime.split(':').map(Number);

                    let currentMinutes = startH * 60 + startM;
                    const endMinutes = endH * 60 + endM;

                    while (currentMinutes + duration <= endMinutes) {
                        const h = Math.floor(currentMinutes / 60);
                        const m = currentMinutes % 60;
                        const timeStr24 = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                        const timeFormatted = moment(timeStr24, "HH:mm").format("hh:mm A");

                        const slotMomentIST = moment.utc(`${targetDateStr} ${timeStr24}`, "YYYY-MM-DD HH:mm").utcOffset("+05:30");
                        const isPast = isToday && slotMomentIST.isBefore(nowIST);

                        const bookedData = bookedMap[timeStr24] || null;
                        const blockReason = dayBlockedReasonsMap[timeStr24] || null;
                        const isManuallyUnavailable = (availabilityConfig?.unavailableSlots || []).map(normalizeTo24H).includes(timeStr24);

                        let slotStatus = "Available";
                        if (blockReason) slotStatus = "Blocked";
                        else if (bookedData) slotStatus = bookedData.status === 'Completed' ? "Completed" : "Booked";
                        else if (isManuallyUnavailable) slotStatus = "Unavailable";
                        else if (isPast) slotStatus = "Past";

                        const extraFee = dayPremiumMap[timeStr24] || 0;

                        daySlots.push({
                            time: timeFormatted,
                            time24: timeStr24,
                            status: slotStatus,
                            isAvailable: slotStatus === "Available",
                            isPremium: extraFee > 0,
                            premiumFee: extraFee,
                            totalFee: baseFee + extraFee,
                            blockReason: blockReason,
                            bookingDetails: bookedData ? {
                                tokenNumber: bookedData.tokenNumber,
                                patientName: bookedData.patientName,
                                status: bookedData.status
                            } : null
                        });

                        currentMinutes += duration;
                    }
                }

                responseData.selectedDateSlots = {
                    date: targetDateStr,
                    totalSlots: daySlots.length,
                    availableCount: daySlots.filter(s => s.isAvailable).length,
                    bookedCount: daySlots.filter(s => s.status === 'Booked' || s.status === 'Completed').length,
                    blockedCount: daySlots.filter(s => s.status === 'Blocked' || s.status === 'Unavailable').length,
                    slots: daySlots
                };
            }
        }

        res.status(200).json({
            success: true,
            message: "Doctor OPD settings and slot configuration fetched successfully.",
            data: responseData
        });

    } catch (error) {
        console.error("Get Doctor OPD Settings Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// @desc    Doctor Updates OPD Timings, Slot Duration & Shift Configurations (Dynamically Syncs Doctor & Availability)
// @route   PUT /hospital-doctor/panel/opd-settings
// @access  Private (Hospital Doctor)
const updateDoctorOpdSettings = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { startTime, endTime, slotDuration, opdFee, roomNumber, availability, premiumSlots } = req.body;

        const doctor = await Doctor.findById(doctorId);
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor profile not found." });
        }

        // 1. Update Doctor Schema Settings
        if (roomNumber !== undefined) {
            if (!doctor.department) doctor.department = {};
            doctor.department.roomNumber = String(roomNumber).trim();
        }

        if (opdFee !== undefined) {
            if (!doctor.fees) doctor.fees = {};
            doctor.fees.clinic = Math.max(0, Number(opdFee));
        }

        if (slotDuration !== undefined) {
            doctor.slotDuration = Math.max(5, Number(slotDuration));
        }

        if (availability !== undefined) {
            const parsedAvail = typeof availability === 'string' ? JSON.parse(availability) : availability;
            if (Array.isArray(parsedAvail)) {
                doctor.availability = parsedAvail;
            }
        }

        await doctor.save();

        // 2. Synchronize with Availability Collection
        const availUpdate = {
            vendorType: 'Doctor'
        };

        if (startTime) availUpdate.startTime = startTime;
        if (endTime) availUpdate.endTime = endTime;
        if (slotDuration) availUpdate.slotDuration = Number(slotDuration);

        if (premiumSlots !== undefined) {
            const parsedPremium = typeof premiumSlots === 'string' ? JSON.parse(premiumSlots) : premiumSlots;
            if (Array.isArray(parsedPremium)) {
                availUpdate.premiumSlots = parsedPremium.map(p => ({
                    time: p.time,
                    extraFee: Number(p.extraFee || 0)
                }));
            }
        }

        const syncedAvailability = await Availability.findOneAndUpdate(
            { vendorId: doctorId },
            { $set: availUpdate },
            { upsert: true, new: true }
        );

        res.status(200).json({
            success: true,
            message: "Doctor OPD settings and availability schedule synchronized successfully.",
            data: {
                doctor: {
                    name: doctor.name,
                    cabinRoom: doctor.department?.roomNumber,
                    opdFee: doctor.fees?.clinic,
                    slotDuration: doctor.slotDuration,
                    availability: doctor.availability
                },
                availabilityConfig: syncedAvailability
            }
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

// @desc    Doctor Marks Patient No-Show & Automatically Alerts the Next Waiting Patient in Queue
// @route   PATCH /hospital-doctor/panel/opd/no-show/:appointmentId
// @access  Private (Hospital Doctor)
const markOpdNoShow = async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const doctorId = req.user.id;
        const { reason } = req.body;

        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const query = {
            doctorId,
            bookingType: 'OPD',
            ...(isObjectId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(query).populate('userId', 'name phone fcmToken');
        if (!appointment) {
            return res.status(404).json({ success: false, message: "OPD Appointment record not found for this doctor." });
        }

        const now = new Date();
        appointment.status = 'No-Show';
        appointment.rescheduleReason = reason || "Patient did not report to cabin when called.";

        // If patient never paid at counter, mark payment as Failed
        if (appointment.paymentStatus === 'Pending') {
            appointment.paymentStatus = 'Failed';
        }

        await appointment.save();

        // 🚀 AUTO-CALL NEXT PATIENT: Find the next confirmed token waiting for this doctor today
        const todayStart = moment(now).startOf('day').toDate();
        const todayEnd = moment(now).endOf('day').toDate();

        const nextWaitingPatient = await Appointment.findOne({
            doctorId,
            hospitalId: appointment.hospitalId,
            bookingType: 'OPD',
            status: 'Confirmed',
            tokenNumber: { $gt: Number(appointment.tokenNumber || 0) },
            appointmentDate: { $gte: todayStart, $lte: todayEnd }
        }).sort({ tokenNumber: 1 }).populate('userId', 'fcmToken name');

        if (nextWaitingPatient && nextWaitingPatient.userId) {
            try {
                const cabinRoom = req.user.department?.roomNumber ? `Cabin ${req.user.department.roomNumber}` : "the OPD Cabin";
                await sendPushNotification(
                    nextWaitingPatient.userId._id,
                    'user',
                    `Your Turn is Next! (Token #${nextWaitingPatient.tokenNumber}) 🔔`,
                    `Please proceed towards ${cabinRoom}. Dr. ${req.user.name} is ready for you.`,
                    { appointmentId: nextWaitingPatient._id.toString(), type: 'opd_next_token_called', tokenNumber: String(nextWaitingPatient.tokenNumber) }
                );
            } catch (e) {}
        }

        res.status(200).json({
            success: true,
            message: `Token #${appointment.tokenNumber} marked as No-Show. Next token #${nextWaitingPatient?.tokenNumber || 'None'} alerted.`,
            tokenNumber: appointment.tokenNumber,
            status: "No-Show",
            nextWaitingToken: nextWaitingPatient?.tokenNumber || null,
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

// @desc    Doctor Blocks an OPD Slot on a Specific Date with Reason (e.g. Emergency OT Call)
// @route   POST /hospital-doctor/panel/opd-slots/block-slot
// @access  Private (Hospital Doctor)
const blockOpdSlotWithReason = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { date, time, reason } = req.body; // e.g. date: "2026-10-16", time: "10:30 AM", reason: "Emergency OT"

        if (!date || !time) {
            return res.status(400).json({ success: false, message: "date and time are required to block a slot." });
        }

        const formattedDate = moment(date, "YYYY-MM-DD").format("YYYY-MM-DD");
        // Normalize time to standard 12H (e.g. "10:30 AM")
        const formattedTime = moment(time, ["hh:mm A", "h:mm A", "HH:mm", "H:mm"]).format("hh:mm A");

        const blockEntry = {
            date: formattedDate,
            time: formattedTime,
            reason: reason || "Doctor unavailable (Emergency)",
            blockedAt: new Date()
        };

        // Update Availability document atomically
        const availability = await Availability.findOneAndUpdate(
            { vendorId: doctorId },
            { 
                $set: { vendorType: 'Doctor' },
                $pull: { blockedSlotsWithReason: { date: formattedDate, time: formattedTime } } // Remove previous entry if any
            },
            { upsert: true, new: true }
        );

        // Push new block entry
        availability.blockedSlotsWithReason.push(blockEntry);
        await availability.save();

        res.status(200).json({
            success: true,
            message: `Slot ${formattedTime} on ${formattedDate} blocked successfully. Reason: ${blockEntry.reason}`,
            data: blockEntry
        });

    } catch (error) {
        console.error("Block OPD Slot Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// @desc    Doctor Reschedules OPD Appointment to Another Date/Slot (Regenerates Token & Alerts Patient)
// @route   POST /hospital-doctor/panel/opd/reschedule
// @access  Private (Hospital Doctor)
const doctorRescheduleOpdAppointment = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { appointmentId, newDate, newTime, reason } = req.body;

        if (!appointmentId || !newDate || !newTime) {
            return res.status(400).json({ success: false, message: "appointmentId, newDate (YYYY-MM-DD), and newTime are required." });
        }

        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const query = {
            doctorId,
            bookingType: 'OPD',
            ...(isObjectId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(query).populate('userId', 'name phone fcmToken');
        if (!appointment) {
            return res.status(404).json({ success: false, message: "OPD Appointment not found or unauthorized." });
        }

        const targetDate = moment(newDate.trim(), "YYYY-MM-DD").startOf('day');
        if (!targetDate.isValid()) {
            return res.status(400).json({ success: false, message: "Invalid newDate format. Use YYYY-MM-DD." });
        }

        // 1. Check if Target Slot is Already Booked on that Date
        const dayStart = targetDate.clone().startOf('day').toDate();
        const dayEnd = targetDate.clone().endOf('day').toDate();

        const isSlotTaken = await Appointment.findOne({
            doctorId,
            bookingType: 'OPD',
            appointmentDate: { $gte: dayStart, $lte: dayEnd },
            appointmentTime: newTime.trim(),
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] },
            _id: { $ne: appointment._id }
        });

        if (isSlotTaken) {
            return res.status(409).json({ success: false, message: `Slot ${newTime} on ${newDate} is already booked by another patient.` });
        }

        // 2. Generate Fresh Daily Token for the New Date (Prevents Token Collision)
        const dailyCount = await Appointment.countDocuments({
            hospitalId: appointment.hospitalId,
            doctorId,
            appointmentDate: { $gte: dayStart, $lte: dayEnd },
            bookingType: 'OPD',
            _id: { $ne: appointment._id }
        });
        const newTokenNumber = dailyCount + 1;

        // 3. Update Appointment
        appointment.appointmentDate = targetDate.toDate();
        appointment.appointmentTime = newTime.trim();
        appointment.tokenNumber = newTokenNumber;
        appointment.rescheduleCount = (appointment.rescheduleCount || 0) + 1;
        appointment.rescheduleReason = reason || "Doctor schedule adjusted";
        appointment.status = 'Confirmed';

        await appointment.save();

        // 4. Alert Patient with New Date, Time and New Token Number
        if (appointment.userId) {
            try {
                const cabin = req.user.department?.roomNumber ? `Cabin ${req.user.department.roomNumber}` : "OPD Cabin";
                await sendPushNotification(
                    appointment.userId._id,
                    'user',
                    `Appointment Rescheduled (New Token #${newTokenNumber})`,
                    `Dr. ${req.user.name} rescheduled your visit to ${newDate} at ${newTime}. Your new token is #${newTokenNumber} (${cabin}).`,
                    { 
                        appointmentId: appointment._id.toString(), 
                        type: 'opd_rescheduled',
                        newTokenNumber: String(newTokenNumber),
                        newDate,
                        newTime
                    }
                );
            } catch (e) {}
        }

        res.status(200).json({
            success: true,
            message: `Appointment rescheduled successfully. New Token #${newTokenNumber} assigned for ${newDate}.`,
            bookingId: appointment.bookingId,
            newDate: newDate.trim(),
            newTime: newTime.trim(),
            newGeneratedTokenNumber: newTokenNumber,
            data: appointment
        });

    } catch (error) {
        console.error("Doctor Reschedule OPD Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Hospital Doctor Finishes OPD Consultation (Marks Completed & Alerts Next Waiting Patient in Lounge)
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

        // Close treatment duration tracking
        if (Array.isArray(appointment.treatmentHistory) && appointment.treatmentHistory.length > 0) {
            const currentShift = appointment.treatmentHistory[appointment.treatmentHistory.length - 1];
            if (currentShift && !currentShift.endTime) {
                currentShift.endTime = now;
                const diffMinutes = Math.round((now - new Date(currentShift.startTime || currentShift.timestamp)) / 60000);
                currentShift.durationDisplay = `${diffMinutes} mins`;
            }
        }

        await appointment.save();

        // 1. Push alert to Current Patient
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

        // 🚀 2. NEXT TOKEN ALERT: Find the next confirmed patient waiting in the queue
        const todayStart = moment(now).startOf('day').toDate();
        const todayEnd = moment(now).endOf('day').toDate();

        const nextWaitingPatient = await Appointment.findOne({
            doctorId,
            hospitalId: appointment.hospitalId,
            bookingType: 'OPD',
            status: 'Confirmed',
            tokenNumber: { $gt: Number(appointment.tokenNumber || 0) },
            appointmentDate: { $gte: todayStart, $lte: todayEnd }
        }).sort({ tokenNumber: 1 }).populate('userId', 'fcmToken name');

        if (nextWaitingPatient && nextWaitingPatient.userId) {
            try {
                const cabinRoom = req.user.department?.roomNumber || "the OPD Cabin";
                await sendPushNotification(
                    nextWaitingPatient.userId._id,
                    'user',
                    `Your Turn is Next! (Token #${nextWaitingPatient.tokenNumber}) 🔔`,
                    `Please proceed towards ${cabinRoom}. Dr. ${req.user.name} is ready for you.`,
                    { appointmentId: nextWaitingPatient._id.toString(), type: 'opd_next_token_called', tokenNumber: String(nextWaitingPatient.tokenNumber) }
                );
            } catch (e) {}
        }

        res.status(200).json({
            success: true,
            message: `Consultation completed for Token #${appointment.tokenNumber || '1'}. Next token #${nextWaitingPatient?.tokenNumber || 'None'} alerted.`,
            tokenNumber: appointment.tokenNumber,
            status: appointment.status,
            nextWaitingToken: nextWaitingPatient?.tokenNumber || null,
            data: appointment
        });

    } catch (error) {
        console.error("Complete OPD Consultation Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// @desc    Get Available Wards & Beds for Hospital Doctor during OPD to IPD conversion
// @route   GET /hospital-doctor/panel/opd/available-beds
// @access  Private (Hospital-Doctor)
const getDoctorAvailableWardsAndBeds = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const doctor = await Doctor.findById(doctorId).select('hospitalId').lean();

        if (!doctor || !doctor.hospitalId) {
            return res.status(400).json({ 
                success: false, 
                message: "Doctor is not linked to any registered hospital." 
            });
        }

        const hospitalId = doctor.hospitalId;

        // Sync real-time ward and bed capacity (Releases any expired 30-min holds)
        await syncHospitalWardAndBedCapacity(hospitalId);

        const [wards, beds] = await Promise.all([
            Ward.find({ hospitalId, isActive: true }).sort({ name: 1 }).lean(),
            Bed.find({ hospitalId, status: 'Available' }).sort({ bedNumber: 1 }).lean()
        ]);

        const wardsWithBeds = wards.map(w => ({
            ...w,
            availableBedsList: beds.filter(b => String(b.wardId) === String(w._id))
        }));

        return res.status(200).json({
            success: true,
            count: wardsWithBeds.length,
            data: wardsWithBeds
        });

    } catch (error) {
        console.error("Get Doctor Available Wards And Beds Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Hospital Doctor Initiates IPD Bed Admission from OPD Consultation (30-Min Bed Hold + Synced treatmentHistory)
// @route   POST /hospital-doctor/panel/opd/initiate-admission
// @access  Private (Hospital-Doctor)
const initiateOpdToIpdAdmission = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const hospitalId = req.user.hospitalId;
        const {
            opdAppointmentId,
            bedId,
            stayDuration = 1,
            triageLevel = 'Urgent',
            bookingReason,
            admissionNotes,
            vitals
        } = req.body;

        if (!opdAppointmentId || !bedId) {
            return res.status(400).json({
                success: false,
                message: "opdAppointmentId and bedId are required to initiate IPD admission."
            });
        }

        const isOpdObjId = mongoose.isValidObjectId(opdAppointmentId);
        const opdQuery = {
            hospitalId,
            bookingType: 'OPD',
            ...(isOpdObjId ? { _id: opdAppointmentId } : { bookingId: String(opdAppointmentId).trim() })
        };

        // Release any expired holds first
        await syncHospitalWardAndBedCapacity(hospitalId);

        const [opdAppt, targetBed] = await Promise.all([
            Appointment.findOne(opdQuery).populate('userId', 'name phone email gender dob bloodGroup insuranceDetails'),
            Bed.findOne({ _id: bedId, hospitalId }).populate('wardId')
        ]);

        if (!opdAppt) {
            return res.status(404).json({
                success: false,
                message: "Parent OPD appointment record not found."
            });
        }

        if (!targetBed || targetBed.status !== 'Available') {
            return res.status(400).json({
                success: false,
                message: "Selected bed is currently not available. Please select another bed."
            });
        }

        // Check if an active IPD hold already exists for this OPD appointment
        const existingHold = await Appointment.findOne({
            opdAppointmentId: opdAppt._id,
            bookingType: 'Admission',
            status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Hospital', 'Cancelled-By-Doctor', 'No-Show'] }
        });

        if (existingHold) {
            return res.status(400).json({
                success: false,
                message: `An IPD admission (#${existingHold.bookingId}) has already been initiated for this OPD consultation.`
            });
        }

        const now = new Date();
        const holdExpiresAt = new Date(now.getTime() + 30 * 60 * 1000); // 30-Minute Bed Hold Window
        const days = Math.max(1, parseInt(stayDuration) || 1);
        const depositAmount = Number(targetBed.pricePerDay || 1000) * days;
        const wardTitle = targetBed.wardId?.name || "General Ward";
        const admissionBookingId = `HKH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        // Lock bed to 'Reserved' for 30 minutes
        targetBed.status = 'Reserved';
        await targetBed.save();

        // Carry forward patient insurance from OPD booking or User profile
        const sourceInsurance = (opdAppt.insuranceDetails && opdAppt.insuranceDetails.hasInsurance)
            ? opdAppt.insuranceDetails
            : (opdAppt.userId?.insuranceDetails?.hasInsurance ? {
                hasInsurance: true,
                insuranceNumber: opdAppt.userId.insuranceDetails.insuranceNumber || "",
                companyName: opdAppt.userId.insuranceDetails.companyName || "",
                insuranceType: opdAppt.userId.insuranceDetails.insuranceType || "",
                masterInsuranceId: opdAppt.userId.insuranceDetails.masterInsuranceId || null,
                insuranceDocument: opdAppt.userId.insuranceDetails.insuranceDocument || null,
                insuranceDocumentFront: opdAppt.userId.insuranceDetails.insuranceDocumentFront || null,
                insuranceDocumentBack: opdAppt.userId.insuranceDetails.insuranceDocumentBack || null,
                approvalStatus: 'Pending'
            } : { hasInsurance: false, approvalStatus: 'None' });

        const resolvedVitals = vitals || opdAppt.clinicalSummary?.vitals || { bp: "", pulse: "", temp: "", spo2: "" };

        // Create IPD Admission with complete treatmentHistory schema sync
        const newAdmission = await Appointment.create({
            userId: opdAppt.userId?._id || opdAppt.userId,
            hospitalId,
            doctorId,
            bedId: targetBed._id,
            opdAppointmentId: opdAppt._id,
            bookingType: 'Admission',
            bedBookingType: triageLevel === 'Emergency' ? 'Emergency-Bed' : 'General-Bed',
            bookingId: admissionBookingId,
            bookingReason: bookingReason || admissionNotes || `Admitted from OPD (Token #${opdAppt.tokenNumber || '1'}) by Dr. ${req.user.name}`,
            triageLevel,
            wardName: wardTitle,
            bedNumber: targetBed.bedNumber,
            stayDuration: days,
            startDate: now,
            endDate: moment(now).add(days, 'days').toDate(),
            appointmentDate: now,
            admissionHoldExpiresAt: holdExpiresAt,
            patients: opdAppt.patients,
            pricingBreakdown: {
                baseFee: depositAmount,
                originalBaseFee: depositAmount,
                visitCharges: 0,
                extraCharges: 0,
                discountAmount: 0,
                subtotal: depositAmount,
                bookedDurationDays: days,
                depositPaidOnBooking: depositAmount
            },
            totalAmount: depositAmount,
            paymentMethod: 'Online',
            paymentStatus: 'Pending',
            status: 'Hospital-Pending',
            insuranceDetails: sourceInsurance,
            clinicalSummary: {
                diagnosis: opdAppt.clinicalSummary?.diagnosis || bookingReason || "",
                admissionNote: admissionNotes || `Admitted from OPD consultation #${opdAppt.bookingId}`,
                vitals: resolvedVitals
            },
            // 🚨 SYNCED TREATMENT HISTORY: Doctor who initiated admission is already Accepted & Active
            treatmentHistory: [{
                fromDoctorId: null,
                toDoctorId: doctorId,
                action: 'Initial-Assignment',
                assignmentSource: 'Doctor-Self-Assigned',
                acceptanceStatus: 'Accepted',
                assignedAt: now,
                acceptedAt: now,
                unacceptedWaitDuration: "0 mins (Admitted from OPD)",
                notes: `Dr. ${req.user.name} (${req.user.speciality || 'Specialist'}) initiated IPD admission from OPD Token #${opdAppt.tokenNumber || '1'} to ${wardTitle} (${targetBed.bedNumber}).`,
                timestamp: now,
                startTime: now,
                endTime: null,
                durationDisplay: "Active Duty"
            }]
        });

        // Mark parent OPD consultation as Completed
        opdAppt.status = 'Completed';
        if (opdAppt.paymentMethod === 'COD' || opdAppt.paymentMethod === 'Cash') {
            opdAppt.paymentStatus = 'Paid';
        }
        await opdAppt.save();

        // Sync ward bed counters
        await syncHospitalWardAndBedCapacity(hospitalId, targetBed.wardId?._id);

        // Notify Patient & Hospital Reception Desk
        Promise.allSettled([
            sendPushNotification(
                opdAppt.userId?._id || opdAppt.userId,
                'user',
                "🏥 IPD Bed Admission Initiated (30-Min Hold)",
                `Dr. ${req.user.name} has reserved Bed ${targetBed.bedNumber} (${wardTitle}) for you. Please pay deposit of ₹${depositAmount} online or at Hospital Reception within 30 minutes.`,
                {
                    type: 'OPD_TO_IPD_ADMISSION_HOLD',
                    serviceType: 'Hospital',
                    appointmentId: String(newAdmission._id),
                    bookingId: admissionBookingId,
                    depositPayable: String(depositAmount),
                    holdExpiresAt: holdExpiresAt.toISOString()
                }
            ),
            notifyAdminsAndVendor(
                hospitalId,
                'hospital',
                `🛏️ New OPD-to-IPD Admission Hold (#${admissionBookingId})`,
                `Dr. ${req.user.name} reserved Bed ${targetBed.bedNumber} (${wardTitle}) for patient ${opdAppt.patients?.[0]?.patientName || 'Patient'}. Deposit due: ₹${depositAmount}.`,
                {
                    type: 'NEW_ADMISSION_HOLD',
                    appointmentId: String(newAdmission._id),
                    bookingId: admissionBookingId
                }
            )
        ]);

        return res.status(201).json({
            success: true,
            message: `Bed ${targetBed.bedNumber} (${wardTitle}) reserved for 30 minutes! Patient can pay ₹${depositAmount} online or at Reception.`,
            admissionHoldExpiresAt: holdExpiresAt,
            depositPayable: depositAmount,
            data: newAdmission
        });

    } catch (error) {
        console.error("Initiate OPD to IPD Admission Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
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