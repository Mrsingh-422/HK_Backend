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
const Medicine = require('../../../models/Medicine'); // 👈 ADD THIS AT THE TOP OF IMPORTS
const { sendPushNotification } = require('../../../utils/notification');
const { deleteFile } = require('../../../utils/fileHandler'); // Import the deleteFile utility
const ProfileUpdateRequest = require('../../../models/ProfileUpdateRequest');
const bcrypt = require('bcryptjs');


const enrichAppointmentClinicalDetails = async (appt) => {
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

    // A. Fetch Current Active Primary Doctor details & active Shift timings
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

    // B. Fetch Bedside Care Team (Co-Doctors) details & active shift timings
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

    // C. Fetch Completed / Transferred previous primary shifts from treatmentHistory
    if (apptObj.treatmentHistory && apptObj.treatmentHistory.length > 0) {
        apptObj.treatmentHistory.forEach(historyLog => {
            // Find closed doctor shifts (excluding the current active doctor's unended shift)
            if (historyLog.toDoctorId && historyLog.endTime) {
                const isCurrentActiveDoc = apptObj.doctorId && 
                                           apptObj.doctorId._id?.toString() === historyLog.toDoctorId._id?.toString() && 
                                           !historyLog.endTime;
                
                if (!isCurrentActiveDoc) {
                    // Check if we already pushed this doctor with this shift to avoid duplicates in timeline
                    const alreadyPushed = treatmentTeamTimeline.some(t => 
                        t.doctorId?.toString() === historyLog.toDoctorId._id?.toString() && 
                        String(t.joinedAt) === String(historyLog.startTime)
                    );

                    if (!alreadyPushed) {
                        treatmentTeamTimeline.push({
                            doctorId: historyLog.toDoctorId._id,
                            name: historyLog.toDoctorId.name,
                            speciality: historyLog.toDoctorId.speciality,
                            qualification: historyLog.toDoctorId.qualification || "MD",
                            profileImage: historyLog.toDoctorId.profileImage,
                            role: "Previous Physician (Discharged)",
                            joinedAt: historyLog.startTime,
                            dischargedAt: historyLog.endTime,
                            duration: historyLog.durationDisplay || ""
                        });
                    }
                }
            }
        });
    }

    let overstayDays = 0;
    let overstayCharge = 0;
    let bedPricePerDay = 0;
    let baseStayDays = 0;
    let baseStayCharge = 0;

    if (apptObj.bedId) {
        bedPricePerDay = apptObj.bedId.pricePerDay || 0;
    }

    if (apptObj.startDate && apptObj.endDate) {
        const start = moment(apptObj.startDate);
        const scheduledEnd = moment(apptObj.endDate);
        
        if (start.isValid() && scheduledEnd.isValid()) {
            baseStayDays = Math.max(1, scheduledEnd.startOf('day').diff(start.startOf('day'), 'days'));
            baseStayCharge = baseStayDays * bedPricePerDay;

            const checkoutTime = apptObj.status === 'Completed' ? moment(apptObj.endDate) : moment();
            const actualEnd = checkoutTime.startOf('day');
            
            overstayDays = actualEnd.diff(scheduledEnd.startOf('day'), 'days');
            if (overstayDays > 0) {
                overstayCharge = overstayDays * bedPricePerDay;
            } else {
                overstayDays = 0;
            }
        }
    }

    const dynamicPricingBreakdown = apptObj.pricingBreakdown ? { ...apptObj.pricingBreakdown } : {
        baseFee: 0, subtotal: 0, originalBaseFee: 0, visitCharges: 0, extraCharges: 0, discountAmount: 0, cancellationFeeApplied: 0, noShowFeeApplied: 0
    };

    if (!dynamicPricingBreakdown.baseFee || dynamicPricingBreakdown.baseFee === 0) {
        dynamicPricingBreakdown.baseFee = baseStayCharge;
    }

    if (overstayCharge > 0) {
        dynamicPricingBreakdown.extraCharges = (dynamicPricingBreakdown.extraCharges || 0) + overstayCharge;
    }

    const dynamicSubtotal = (dynamicPricingBreakdown.baseFee || 0) + (dynamicPricingBreakdown.visitCharges || 0) + (dynamicPricingBreakdown.extraCharges || 0);
    dynamicPricingBreakdown.subtotal = dynamicSubtotal;

    const discount = dynamicPricingBreakdown.discountAmount || 0;
    const dynamicTotalAmount = Math.max(0, dynamicSubtotal - discount);

    apptObj.pricingBreakdown = dynamicPricingBreakdown;

    if (!apptObj.totalAmount || apptObj.totalAmount === 0) {
        apptObj.totalAmount = dynamicTotalAmount;
    }

    const billingBreakdown = {
        baseStayDays,
        baseStayCharge,
        overstayDays,
        overstayCharge,
        bedPricePerDay,
        estimatedTotal: dynamicTotalAmount,
        currentBillAmount: apptObj.totalAmount
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

// --- 1. DASHBOARD CONTROLLER (Hospital Doctor Panel) ---
const getDocDashboard = async (req, res) => {
    try {
        const doctorId = req.user.id;
        
        // 🚀 SYNCHRONIZED: Pending transfer requests headed to me
        const transferCount = await Appointment.countDocuments({ 
            pendingDoctorId: doctorId 
        });

        // 🚀 SYNCHRONIZED: Total active patients currently assigned to me (excluding in-transit)
        const activeCount = await Appointment.countDocuments({ 
            doctorId, 
            pendingDoctorId: null,
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] }
        });

        const stats = {
            totalCases: await Appointment.countDocuments({ doctorId }),
            requests: transferCount, // Align requests directly to incoming transfers
            active: activeCount
        };

        // 🚀 SYNCHRONIZED: Emergency workload currently assigned to me
        const emergencyCount = await Appointment.countDocuments({ 
            doctorId, 
            pendingDoctorId: null,
            ambulanceId: { $ne: null, $exists: true }, // Brought strictly by Ambulance
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] } 
        });

        // 🚀 SYNCHRONIZED: Direct admissions workload currently assigned to me
        const admissionCount = await Appointment.countDocuments({ 
            doctorId, 
            pendingDoctorId: null,
            bookingType: 'Admission', 
            $or: [
                { ambulanceId: null },
                { ambulanceId: { $exists: false } }
            ],
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] } 
        });

        res.json({
            success: true,
            welcomeName: req.user.name,
            dutyStatus: req.user.dutyStatus, 
            stats,
            grid: { emergencyCount, admissionCount, transferCount }
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};





// --- 4. CREATE PRESCRIPTION (Updated with Safe Multipart and Diet Plan PDF support) ---
// --- 4. CREATE PRESCRIPTION (Updated with Screenshot Fields & Dual PDF Support) ---
const processPrescription = async (req, res) => {
    try {
        const { 
            appointmentId, 
            diagnosis, 
            medicines, 
            advice,
            advisedInvestigations,   
            adviceGiven,             
            specialInstructions,     
            nextAppointment          
        } = req.body;

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) return res.status(404).json({ success: false, message: "Appointment record not found" });

        // SECURE ACCESS VALIDATION
        const isPrimaryDoc = appointment.doctorId && appointment.doctorId.toString() === req.user.id;
        const isCareTeamMember = appointment.bedsideCareTeam.some(d => 
            d.doctorId.toString() === req.user.id && ['Accepted', 'In-Progress'].includes(d.status)
        );

        if (!isPrimaryDoc && !isCareTeamMember) {
            return res.status(403).json({ 
                success: false, 
                message: "Access Denied: Aap is patient ke active treating physician ya bedside team member nahi hain. Prescription blocked." 
            });
        }
        
        const diagnosisArray = typeof diagnosis === 'string' ? JSON.parse(diagnosis) : (Array.isArray(diagnosis) ? diagnosis : []);
        const medicinesArray = typeof medicines === 'string' ? JSON.parse(medicines) : (Array.isArray(medicines) ? medicines : []);

        let prescriptionPdfPath = null;
        let dietPlanPath = null;

        if (req.files) {
            if (req.files.prescriptionPdf && req.files.prescriptionPdf[0]) {
                prescriptionPdfPath = `/uploads/doctor_prescriptions/${req.files.prescriptionPdf[0].filename}`;
            }
            if (req.files.dietPlanPdf && req.files.dietPlanPdf[0]) {
                dietPlanPath = `/uploads/diet_plans/${req.files.dietPlanPdf[0].filename}`;
            }
        }

        // 🚀 SYNC FIX: Check if a prescription already exists for this appointmentId to prevent double records
        let prescription = await Prescription.findOne({ appointmentId });

        if (prescription) {
            // Update existing record
            prescription.doctorId = req.user.id;
            prescription.userId = appointment.userId;
            prescription.diagnosis = diagnosisArray;
            prescription.medicines = medicinesArray;
            prescription.additionalNotes = advice || adviceGiven || prescription.additionalNotes || "";
            prescription.advisedInvestigations = advisedInvestigations || prescription.advisedInvestigations || "None";
            prescription.adviceGiven = adviceGiven || prescription.adviceGiven || "";
            prescription.specialInstructions = specialInstructions || prescription.specialInstructions || "";
            prescription.nextAppointment = nextAppointment || prescription.nextAppointment || "";
            if (prescriptionPdfPath) prescription.pdfUrl = prescriptionPdfPath;
            if (dietPlanPath) prescription.dietPlanPdf = dietPlanPath;

            await prescription.save();
        } else {
            // Create new prescription
            prescription = await Prescription.create({
                appointmentId,
                doctorId: req.user.id,
                userId: appointment.userId,
                diagnosis: diagnosisArray,
                medicines: medicinesArray, 
                additionalNotes: advice || adviceGiven || "",
                advisedInvestigations: advisedInvestigations || "None",
                adviceGiven: adviceGiven || "",
                specialInstructions: specialInstructions || "",
                nextAppointment: nextAppointment || "",
                pdfUrl: prescriptionPdfPath,
                dietPlanPdf: dietPlanPath
            });
        }

        res.status(201).json({ 
            success: true, 
            message: "Prescription and digital documentation compiled successfully.", 
            data: prescription 
        });

    } catch (error) { 
        console.error("Prescription Creation Error:", error);
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

        const appointment = await Appointment.findOne({ _id: appointmentId, doctorId: mainDoctorId });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Unauthorized: Aap is patient ke main doctor nahi hain." });
        }

        // Check if specialist already requested
        const exists = appointment.bedsideCareTeam.find(d => d.doctorId.toString() === specialistDoctorId);
        if (exists) {
            return res.status(400).json({ success: false, message: "This specialist is already requested or active on the care team." });
        }

        // Push new bedside request
        appointment.bedsideCareTeam.push({
            doctorId: specialistDoctorId,
            status: 'Pending',
            requestReason: reason,
            patientConditionAtRequest: patientCondition,
            priority: priority || 'Routine'
        });

        await appointment.save();
        res.status(201).json({ success: true, message: "Bedside help request sent to specialist successfully!" });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. RESPOND TO BEDSIDE REQUEST (Specialist Doctor Action: Accept or Reject with Reason)
const respondToBedsideRequest = async (req, res) => {
    try {
        const { appointmentId, action, rejectionReason } = req.body; // action: 'Accepted' ya 'Rejected'
        const specialistId = req.user.id;

        const appointment = await Appointment.findOne({ 
            _id: appointmentId, 
            "bedsideCareTeam.doctorId": specialistId,
            "bedsideCareTeam.status": "Pending"
        });

        if (!appointment) {
            return res.status(404).json({ success: false, message: "No pending bedside request found for you on this case." });
        }

        // Find specialist object in array and update
        const careTeamObj = appointment.bedsideCareTeam.find(d => d.doctorId.toString() === specialistId);
        careTeamObj.status = action;
        careTeamObj.respondedAt = new Date();

        if (action === 'Rejected') {
            careTeamObj.rejectionReason = rejectionReason || "Busy on another case";
        }

        await appointment.save();
        res.json({ success: true, message: `Bedside request successfully ${action}!`, data: appointment });

    } catch (error) {
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

// --- UPDATE FOR getAssignedCases: Native support for Bedside and Pending-Admissions tabs ---
// Endpoint: GET /hospital-doctor/panel/cases?tab=active&page=1&limit=10
const getAssignedCases = async (req, res) => {
    try {
        const { type, status, tab = 'active', page = 1, limit = 10 } = req.query; 

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 10);
        const skip = (pageNum - 1) * limitNum;

        let query = {};

        // Case A: Active patients assigned to this doctor
        if (tab === 'active') {
            query = { 
                doctorId: req.user.id, 
                pendingDoctorId: null,
                status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] } 
            };
        } 
        // Case B: Ready for Discharge patients
        else if (tab === 'discharge') {
            query = {
                doctorId: req.user.id,
                pendingDoctorId: null,
                status: 'Discharge-Pending' 
            };
        }
        // Case C: Incoming pending handover requests
        else if (tab === 'pending') {
            query = { pendingDoctorId: req.user.id };
        } 
        // Case D: Comprehensive History Tray
        else if (tab === 'history') {
            query = {
                $or: [
                    {
                        $and: [
                            { 
                                $or: [
                                    { "treatmentHistory.fromDoctorId": req.user.id },
                                    { "treatmentHistory.toDoctorId": req.user.id }
                                ] 
                            },
                            {
                                $or: [
                                    { doctorId: { $ne: req.user.id } },
                                    { status: 'Completed' }
                                ]
                            }
                        ]
                    },
                    {
                        "bedsideCareTeam": {
                            $elemMatch: {
                                doctorId: req.user.id,
                                status: 'Completed'
                            }
                        }
                    }
                ]
            };
        }
        // Case E: Active Bedside Specialist Care
        else if (tab === 'bedside') {
            query = {
                "bedsideCareTeam": {
                    $elemMatch: {
                        doctorId: req.user.id,
                        status: { $in: ['Accepted', 'In-Progress'] }
                    }
                }
            };
        }
        // Case F: Pending Bedside Specialists Requests
        else if (tab === 'pending-bedside') {
            query = {
                "bedsideCareTeam": {
                    $elemMatch: {
                        doctorId: req.user.id,
                        status: 'Pending'
                    }
                }
            };
        }
        // Case G: Pending Admissions waiting for Doctor assignment
        else if (tab === 'pending-admissions') {
            query = {
                hospitalId: req.user.hospitalId,
                bookingType: 'Admission',
                doctorId: null,
                status: 'In-Progress'
            };
        }
        // Case H: Transferred Out / Outgoing Handovers
        else if (tab === 'transferred-out') {
            query = {
                $or: [
                    { 
                        doctorId: req.user.id, 
                        pendingDoctorId: { $ne: null } 
                    },
                    {
                        doctorId: { $ne: req.user.id },
                        "treatmentHistory": {
                            $elemMatch: {
                                fromDoctorId: req.user.id,
                                action: { $in: ['Transfer-Initiated', 'Discharged'] }
                            }
                        }
                    }
                ]
            };
        }

        if (type === 'Emergency') {
            query.ambulanceId = { $ne: null, $exists: true };
        }
        if (type === 'Admission') {
            query.bookingType = 'Admission';
            query.$or = [
                { ambulanceId: null },
                { ambulanceId: { $exists: false } }
            ];
        }

        if (status) query.status = status;

        const totalRecords = await Appointment.countDocuments(query);

        const cases = await Appointment.find(query)
            .populate('userId', 'name phone email profilePic age gender bloodGroup familyMember')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay status',
                populate: { path: 'wardId', select: 'name type' }
            })
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limitNum);

        // 🎯 Clean DTO Mapping for Doctor Tray Cards
        const cleanedCases = cases.map(appt => ({
            _id: appt._id,
            bookingId: appt.bookingId,
            status: appt.status,
            triageLevel: appt.triageLevel || "Routine",
            startDate: appt.startDate,
            endDate: appt.endDate,
            stayDuration: appt.stayDuration || 1,

            patientDetails: resolvePatientDTO(appt),

            bedDetails: appt.bedId ? {
                _id: appt.bedId._id,
                bedNumber: appt.bedId.bedNumber || appt.bedNumber || "N/A",
                wardName: appt.bedId.wardId?.name || appt.wardName || "N/A",
                wardType: appt.bedId.wardId?.type || "Ward",
                pricePerDay: appt.bedId.pricePerDay || 0
            } : null,

            pendingDoctorId: appt.pendingDoctorId || null,
            createdAt: appt.createdAt,
            updatedAt: appt.updatedAt
        }));

        res.json({ 
            success: true, 
            totalRecords,
            totalPages: Math.ceil(totalRecords / limitNum),
            currentPage: pageNum,
            count: cleanedCases.length,
            data: cleanedCases 
        });
    } catch (error) { 
        console.error("getAssignedCases Error:", error);
        res.status(500).json({ message: error.message }); 
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

// --- GET PATIENT DETAILS (Updated with populated Bedside team profiles) ---
// Endpoint: GET /hospital-doctor/panel/case-details/:id
const getPatientDetails = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Fetch appointment with full relational populations (Hospital, Bed, Doctor, Bedside Team)
        const appointment = await Appointment.findById(id)
            .populate('hospitalId', 'name address city state country zipCode phone email hospitalImage type')
            .populate('userId', 'name phone email profilePic age gender bloodGroup familyMember address')
            .populate('doctorId', 'name speciality qualification profileImage')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay status isVentilatorAvailable',
                populate: { path: 'wardId', select: 'name type totalBeds availableBeds' }
            })
            .populate('treatmentHistory.fromDoctorId', 'name speciality qualification profileImage')
            .populate('treatmentHistory.toDoctorId', 'name speciality qualification profileImage')
            .populate('bedsideCareTeam.doctorId', 'name speciality qualification profileImage dutyStatus')
            .populate('clinicalLogs.doctorId', 'name speciality qualification profileImage')
            .populate('activeMedications.addedBy', 'name speciality qualification profileImage');

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Patient Case / Admission Record Not Found." });
        }

        // 2. Fetch latest Prescription (if compiled)
        const Prescription = require('../../../models/Prescription');
        const prescription = await Prescription.findOne({ appointmentId: id }).sort({ createdAt: -1 });

        // 3. Resolve Accurate Patient Profile & Blood Group (Family Member vs Self)
        const resolvedPatientProfile = resolvePatientDTO(appointment);

        // 4. Format Hospital Details cleanly
        const hospitalDetails = appointment.hospitalId ? {
            _id: appointment.hospitalId._id,
            name: appointment.hospitalId.name,
            address: appointment.hospitalId.address || "N/A",
            city: appointment.hospitalId.city || "",
            state: appointment.hospitalId.state || "",
            country: appointment.hospitalId.country || "India",
            zipCode: appointment.hospitalId.zipCode || "",
            fullAddress: `${appointment.hospitalId.address ? appointment.hospitalId.address + ', ' : ''}${appointment.hospitalId.city || ''}, ${appointment.hospitalId.state || ''} - ${appointment.hospitalId.zipCode || ''}`.replace(/^, |, $/g, ''),
            phone: appointment.hospitalId.phone || "N/A",
            email: appointment.hospitalId.email || "N/A",
            logo: appointment.hospitalId.hospitalImage?.[0] || null,
            hospitalType: appointment.hospitalId.type || "Private"
        } : null;

        // 5. Build Standardized Production Case File
        const caseDetailsData = {
            _id: appointment._id,
            bookingId: appointment.bookingId,
            status: appointment.status,
            bookingType: appointment.bookingType || 'Admission',
            bedBookingType: appointment.bedBookingType || 'General-Bed',
            triageLevel: appointment.triageLevel || 'Routine',
            bookingReason: appointment.bookingReason || "General Hospital Admission",
            startDate: appointment.startDate,
            endDate: appointment.endDate,
            stayDuration: appointment.stayDuration || 1,
            
            // 🏥 Complete Hospital Header Information
            hospitalDetails,

            // 👤 Patient Information (Accurate Blood Group & Family Details)
            patientDetails: resolvedPatientProfile,
            bloodGroup: resolvedPatientProfile.bloodGroup,

            // 🛏️ Bed & Ward Details
            bedDetails: appointment.bedId ? {
                _id: appointment.bedId._id,
                bedNumber: appointment.bedId.bedNumber,
                pricePerDay: appointment.bedId.pricePerDay || 0,
                status: appointment.bedId.status,
                isVentilatorAvailable: Boolean(appointment.bedId.isVentilatorAvailable),
                ward: appointment.bedId.wardId ? {
                    _id: appointment.bedId.wardId._id,
                    name: appointment.bedId.wardId.name,
                    type: appointment.bedId.wardId.type,
                    availableBeds: appointment.bedId.wardId.availableBeds,
                    totalBeds: appointment.bedId.wardId.totalBeds
                } : { name: appointment.wardName || "N/A", type: "Ward" }
            } : null,

            // 👨‍⚕️ Primary Assigned Doctor
            primaryDoctor: appointment.doctorId ? {
                _id: appointment.doctorId._id,
                name: appointment.doctorId.name,
                speciality: appointment.doctorId.speciality,
                qualification: appointment.doctorId.qualification || "MBBS, MD",
                profileImage: appointment.doctorId.profileImage || null
            } : null,

            // 📋 Clinical Summary & Vitals
            clinicalSummary: {
                chiefComplaint: appointment.clinicalSummary?.chiefComplaint || appointment.bookingReason || "",
                triagePriority: appointment.clinicalSummary?.triagePriority || appointment.triageLevel || "Routine",
                admissionNote: appointment.clinicalSummary?.admissionNote || "",
                bloodGroup: resolvedPatientProfile.bloodGroup,
                diagnosis: appointment.clinicalSummary?.diagnosis || "",
                investigation: appointment.clinicalSummary?.investigation || "",
                treatmentResult: appointment.clinicalSummary?.treatmentResult || "",
                dischargeNote: appointment.clinicalSummary?.dischargeNote || "",
                dateOfSurgery: appointment.clinicalSummary?.dateOfSurgery || null,
                conditionDuringAdmission: appointment.clinicalSummary?.conditionDuringAdmission || "Stable",
                conditionDuringDischarge: appointment.clinicalSummary?.conditionDuringDischarge || "",
                vitals: appointment.clinicalSummary?.vitals || { bp: "", pulse: "", temp: "", spo2: "" },
                uploadedReports: appointment.clinicalSummary?.uploadedReports || [],
                dischargeSummaryPdf: appointment.clinicalSummary?.dischargeSummaryPdf || null
            },

            // 🩺 Physician Daily Progress Rounds
            clinicalLogs: appointment.clinicalLogs || [],

            // 👥 Bedside Care Specialists Team
            bedsideCareTeam: appointment.bedsideCareTeam || [],

            // 💊 In-Patient Active Medications
            activeMedications: appointment.activeMedications || [],

            // ⏱️ Treatment Shifts & Handover History
            treatmentHistory: appointment.treatmentHistory || [],

            // 💳 Billing & Payment Summary
            billing: {
                totalAmount: appointment.totalAmount || 0,
                baseFee: appointment.pricingBreakdown?.baseFee || 0,
                extraCharges: appointment.pricingBreakdown?.extraCharges || 0,
                discountAmount: appointment.pricingBreakdown?.discountAmount || 0,
                paymentMethod: appointment.paymentMethod || 'Online',
                paymentStatus: appointment.paymentStatus || 'Pending',
                transactionId: appointment.transactionId || null
            },

            // 🛡️ Cashless Insurance Information
            insurance: {
                hasInsurance: Boolean(appointment.insuranceDetails?.hasInsurance || appointment.hasInsurance),
                companyName: appointment.insuranceDetails?.companyName || "",
                insuranceNumber: appointment.insuranceDetails?.insuranceNumber || "",
                insuranceType: appointment.insuranceDetails?.insuranceType || "Cashless",
                approvalStatus: appointment.insuranceDetails?.approvalStatus || "Pending",
                approvalLetterPdf: appointment.insuranceDetails?.approvalLetterPdf || null
            },

            // 📑 Compiled Prescription
            prescription: prescription ? {
                _id: prescription._id,
                pdfUrl: prescription.pdfUrl || null,
                dietPlanPdf: prescription.dietPlanPdf || null,
                medicines: prescription.medicines || [],
                diagnosis: prescription.diagnosis || [],
                chiefComplaints: prescription.chiefComplaints || "",
                advisedInvestigations: prescription.advisedInvestigations || "None",
                adviceGiven: prescription.adviceGiven || "",
                specialInstructions: prescription.specialInstructions || "",
                nextAppointment: prescription.nextAppointment || ""
            } : null,

            // 👤 Booking Account Holder (Contact info)
            bookedBy: appointment.userId ? {
                userId: appointment.userId._id,
                name: appointment.userId.name,
                phone: appointment.userId.phone,
                email: appointment.userId.email
            } : null,

            createdAt: appointment.createdAt,
            updatedAt: appointment.updatedAt
        };

        res.json({
            success: true,
            data: caseDetailsData
        });

    } catch (error) {
        console.error("getPatientDetails Error:", error);
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
            if (!method) return "Pending";
            if (method.toUpperCase() === 'ONLINE' || method.toUpperCase() === 'UPI') return "UPI (Google Pay)";
            if (method.toUpperCase() === 'CASH' || method.toUpperCase() === 'COD') return "Cash / Offline";
            return method;
        };

        // 🚨 DYNAMIC BLOOD GROUP RESOLUTION FOR DISCHARGE PRINT
        const patientBloodGroup = appt.clinicalSummary?.bloodGroup || 
                                  appt.patients?.[0]?.bloodGroup || 
                                  appt.userId?.bloodGroup || 
                                  "N/A";

        const figmaDataSheet = {
            header: {
                hospitalName: appt.hospitalId?.name || "RADIUS HOSPITAL",
                hospitalAddress: appt.hospitalId?.address || "Mohali, Punjab",
                hospitalLogo: appt.hospitalId?.hospitalImage?.[0] || null,
                leadDoctor: {
                    name: appt.doctorId?.name || "Attending Physician",
                    title: `Department of ${appt.doctorId?.speciality || 'Medicine'}`,
                    qualification: appt.doctorId?.qualification || "MD"
                },
                collaborativeDoctors: dynamicHandoffDoctors
            },

            patientDetails: {
                appointmentId: appt.bookingId,
                name: appt.patients?.[0]?.patientName || appt.userId?.name || "N/A",
                address: appt.address?.city ? `${appt.address.houseNo || ''} ${appt.address.city}` : (appt.userId?.address || "N/A"),
                gender: appt.patients?.[0]?.gender || appt.userId?.gender || "Male",
                age: appt.patients?.[0]?.patientAge || appt.userId?.age || 30,
                bloodGroup: patientBloodGroup, // 👈 Injected Dynamic Blood Group
                
                dateOfAdmission: appt.startDate ? moment(appt.startDate).format("YYYY-MM-DD") : "N/A",
                department: appt.doctorId?.speciality 
                    ? `Department of ${appt.doctorId.speciality}, Unit - 1` 
                    : "Department of Medicine, Unit - 1",
                
                dateOfDischarge: appt.endDate ? moment(appt.endDate).format("YYYY-MM-DD") : "N/A",
                dateOfSurgery: appt.clinicalSummary?.dateOfSurgery 
                    ? moment(appt.clinicalSummary.dateOfSurgery).format("YYYY-MM-DD") 
                    : "N/A",
                
                insuranceStatus: appt.insuranceDetails?.hasInsurance || appt.hasInsurance ? "Verified (Cashless)" : "N/A",
                paymentStatus: appt.paymentStatus || "Pending",
                paymentType: formatPaymentMethod(appt.paymentMethod),
                
                conditionDuringAdmission: appt.clinicalSummary?.conditionDuringAdmission || "Stable",
                conditionDuringDischarge: appt.clinicalSummary?.conditionDuringDischarge || "Recovered & Stable",

                chiefComplaints: appt.clinicalSummary?.chiefComplaint || appt.patients?.[0]?.reasonForVisit || "N/A",
                diagnosis: appt.clinicalSummary?.diagnosis || "N/A"
            },

            clinicalNotes: appt.clinicalSummary?.admissionNote || "N/A",

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
                anySpecialInstructionGiven: "This digital Discharge Document is not valid for Medico Legal purpose.",
                nextAppointment: appt.endDate ? moment(appt.endDate).add(7, 'days').format("YYYY-MM-DD") : "N/A"
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

// --- API: GET DOCTOR COMPLETED/TRANSFERRED CASES HISTORY (Paginated & Searchable) ---
// Endpoint: GET /hospital-doctor/panel/cases/history-list?page=1&limit=10&search=HKH
const getDoctorHistory = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { page = 1, limit = 10, search } = req.query;
        
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 10);
        const skip = (pageNum - 1) * limitNum;

        let query = {
            $and: [
                {
                    $or: [
                        { doctorId: doctorId },
                        { "treatmentHistory.fromDoctorId": doctorId },
                        { "treatmentHistory.toDoctorId": doctorId },
                        { "bedsideCareTeam.doctorId": doctorId }
                    ]
                },
                {
                    $or: [
                        { doctorId: { $ne: doctorId } }, 
                        { status: 'Completed' }          
                    ]
                }
            ]
        };

        if (search) {
            const isBookingId = search.toUpperCase().startsWith('HKH-') || search.toUpperCase().startsWith('HK-');
            if (isBookingId) {
                query.bookingId = { $regex: search, $options: 'i' };
            } else {
                const User = require('../../../models/User');
                const matchedUsers = await User.find({
                    name: { $regex: search, $options: 'i' }
                }).select('_id');
                const userIds = matchedUsers.map(u => u._id);
                query.userId = { $in: userIds };
            }
        }

        const totalRecords = await Appointment.countDocuments(query);

        const history = await Appointment.find(query)
            .populate('userId', 'name phone email profilePic age gender bloodGroup familyMember')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay status',
                populate: { path: 'wardId', select: 'name type' }
            })
            .populate('doctorId', 'name speciality qualification profileImage')
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limitNum);

        const cleanedHistory = await Promise.all(history.map(async (appt) => {
            const enriched = await enrichAppointmentClinicalDetails(appt);
            
            return {
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
                    wardName: appt.bedId.wardId?.name || "N/A"
                } : null,

                assignedDoctor: appt.doctorId ? {
                    _id: appt.doctorId._id,
                    name: appt.doctorId.name,
                    speciality: appt.doctorId.speciality,
                    qualification: appt.doctorId.qualification || "MBBS"
                } : null,

                billing: {
                    totalAmount: appt.totalAmount || 0,
                    paymentMethod: appt.paymentMethod || 'Online',
                    paymentStatus: appt.paymentStatus || 'Paid'
                },

                clinicalFiles: enriched.clinicalFiles,
                updatedAt: appt.updatedAt
            };
        }));

        res.json({
            success: true,
            totalRecords,
            totalPages: Math.ceil(totalRecords / limitNum),
            currentPage: pageNum,
            count: cleanedHistory.length,
            data: cleanedHistory
        });

    } catch (error) {
        console.error("getDoctorHistory Error:", error);
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
    doctorSelfAssignCase,addPrimaryClinicalLog,addActiveMedication,stopActiveMedication
};