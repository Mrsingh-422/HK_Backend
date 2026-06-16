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

// --- 12. UPDATE MY DOCTOR PROFILE (PUT API - Secure and Multer Image supported) ---
const updateDoctorProfile = async (req, res) => {
    try {
        const doctorId = req.user.id;
        
        // Allowed professional fields for self-update (Excludes role, email, phone, profileStatus)
        const { 
            name, country, state, city, address, 
            qualification, speciality, about, experienceYears, 
            languages, fees, consultationStatus 
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
        
        // Handle languages array parsing
        if (languages) {
            updates.languages = Array.isArray(languages) ? languages : JSON.parse(languages);
        }
        
        // Handle dynamic nested fees object safely
        if (fees) {
            updates.fees = typeof fees === 'string' ? JSON.parse(fees) : fees;
        }
        
        // Handle dynamic nested consultation status safely
        if (consultationStatus) {
            updates.consultationStatus = typeof consultationStatus === 'string' ? JSON.parse(consultationStatus) : consultationStatus;
        }

        // Handle single profile image upload from multer fields
        if (req.files && req.files.profileImage) {
            updates.profileImage = `/uploads/doctors/${req.files.profileImage[0].filename}`;
        }

        const updatedDoctor = await Doctor.findByIdAndUpdate(
            doctorId,
            { $set: updates },
            { new: true, runValidators: true }
        ).select('-password');

        res.json({ 
            success: true, 
            message: "Doctor profile updated successfully.", 
            data: updatedDoctor 
        });

    } catch (error) {
        console.error("Profile update error:", error);
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
        
        const stats = {
            totalCases: await Appointment.countDocuments({ doctorId }),
            requests: await Appointment.countDocuments({ doctorId, status: 'Hospital-Pending' }),
            active: await Appointment.countDocuments({ doctorId, status: 'In-Progress' })
        };

        const emergencyCount = await Appointment.countDocuments({ doctorId, triageLevel: 'Emergency', status: 'In-Progress' });
        const admissionCount = await Appointment.countDocuments({ doctorId, bookingType: 'Admission', status: 'In-Progress' });
        const transferCount = await Appointment.countDocuments({ doctorId, status: 'Hospital-Pending' }); 

        res.json({
            success: true,
            welcomeName: req.user.name,
            dutyStatus: req.user.dutyStatus, 
            stats,
            grid: { emergencyCount, admissionCount, transferCount }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};



// --- 3. GET PATIENT DETAILS ---
// const getPatientDetails = async (req, res) => {
//     try {
//         const patient = await Appointment.findById(req.params.id)
//             .populate('userId', 'name profilePic phone age gender bloodGroup')
//             .populate('bedId', 'bedNumber pricePerDay')
//             .populate({
//                 path: 'treatmentHistory.fromDoctorId',
//                 select: 'name speciality profileImage'
//             })
//             .populate({
//                 path: 'treatmentHistory.toDoctorId',
//                 select: 'name speciality profileImage'
//             });

//         if (!patient) return res.status(404).json({ message: "Patient not found" });
//         res.json({ success: true, data: patient });
//     } catch (error) { res.status(500).json({ message: error.message }); }
// };

// --- 4. CREATE PRESCRIPTION (Fixed Array Safe Map Logic) ---
// --- 4. CREATE PRESCRIPTION (Updated with Safe Multipart and Diet Plan PDF support) ---
const processPrescription = async (req, res) => {
    try {
        const { appointmentId, diagnosis, medicines, advice } = req.body;

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) return res.status(404).json({ success: false, message: "Appointment record not found" });

        // SECURE ACCESS VALIDATION: Only primary doctor or accepted bedside specialists can prescribe
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
        
        // Safe parsing for inputs coming via multipart/form-data
        const diagnosisArray = typeof diagnosis === 'string' ? JSON.parse(diagnosis) : (Array.isArray(diagnosis) ? diagnosis : []);
        const medicinesArray = typeof medicines === 'string' ? JSON.parse(medicines) : (Array.isArray(medicines) ? medicines : []);

        // Extract uploaded diet plan PDF path safely from multer
        let dietPlanPath = null;
        if (req.file) {
            dietPlanPath = `/uploads/diet_plans/${req.file.filename}`;
        }

        const prescription = await Prescription.create({
            appointmentId,
            doctorId: req.user.id,
            userId: appointment.userId,
            diagnosis: diagnosisArray,
            medicines: medicinesArray, // Saves multiple medicines array seamlessly
            additionalNotes: advice,
            dietPlanPdf: dietPlanPath // Saves optional diet plan PDF path link
        });

        res.status(201).json({ success: true, message: "Prescription added successfully", data: prescription });
    } catch (error) { 
        console.error("Prescription Creation Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. TRANSFER PATIENT HANDOVER (Doctor A Panel)
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

        // 1. Close Doctor A's (current doctor) active shift in history
        const activeShift = appointment.treatmentHistory.find(h => 
            h.toDoctorId && h.toDoctorId.toString() === req.user.id && !h.endTime
        );
        if (activeShift) {
            activeShift.endTime = now;
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

// 4. GET ASSIGNED & PENDING INCOMING CASES (Updated)
// const getAssignedCases = async (req, res) => {
//     try {
//         const { type, status, tab = 'active' } = req.query; // tab: 'active', 'pending', 'history', 'discharge'
//         let query = {};

//         // Case A: Active patients currently assigned to me (EXCLUDED Discharge-Pending!)
//         if (tab === 'active') {
//             query = { 
//                 doctorId: req.user.id, 
//                 pendingDoctorId: null,
//                 status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] } // 👈 Ready to discharge wale beds active se hat gaye
//             };
//         } 
//         // Case B: Ready for Discharge patients (Waiting for Admin Billing)
//         else if (tab === 'discharge') {
//             query = {
//                 doctorId: req.user.id,
//                 pendingDoctorId: null,
//                 status: 'Discharge-Pending' // 👈 Strictly Discharge-Pending beds only
//             };
//         }
//         // Case C: Incoming pending handover requests
//         else if (tab === 'pending') {
//             query = { pendingDoctorId: req.user.id };
//         } 
//         // Case D: History Patients (Treated in past)
//         else if (tab === 'history') {
//             query = {
//                 $and: [
//                     { 
//                         $or: [
//                             { "treatmentHistory.fromDoctorId": req.user.id },
//                             { "treatmentHistory.toDoctorId": req.user.id }
//                         ] 
//                     },
//                     {
//                         $or: [
//                             { doctorId: { $ne: req.user.id } }, // currently with another doctor
//                             { status: 'Completed' }             // fully discharged
//                         ]
//                     }
//                 ]
//             };
//         }

//         if (type === 'Emergency') query.triageLevel = 'Emergency';
//         if (type === 'Admission') query.bookingType = 'Admission';
//         if (status) query.status = status;

//         const cases = await Appointment.find(query)
//             .populate('userId', 'name profilePic phone age gender')
//             .sort({ updatedAt: -1 });

//         res.json({ success: true, count: cases.length, data: cases });
//     } catch (error) { res.status(500).json({ message: error.message }); }
// };

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

// --- 7. DISCHARGE SUMMARY ---
// --- 7. DISCHARGE SUMMARY (Fixed: Setting status to 'Discharge-Pending' for billing sync) ---
// --- 7. DISCHARGE SUMMARY (Updated with safe atomic $set and Multiple file uploads) ---
const submitDischargeSummary = async (req, res) => {
    try {
        const { appointmentId, diagnosis, investigation, treatmentResult, dischargeNote } = req.body;

        const now = new Date();

        // 1. Close Active Doctor's shift
        const appointmentObj = await Appointment.findById(appointmentId);
        if (!appointmentObj) return res.status(404).json({ success: false, message: "Case not found" });

        const activeShift = appointmentObj.treatmentHistory.find(h => 
            h.toDoctorId && h.toDoctorId.toString() === req.user.id && !h.endTime
        );
        if (activeShift) {
            activeShift.endTime = now;
            activeShift.durationDisplay = calculateDurationDisplay(activeShift.startTime, now);
        }

        // 2. Fetch uploaded multiple files paths from multer
        const files = req.files || [];
        const reportPaths = files.map(f => `/uploads/doctor_reports/${f.filename}`);

        const updateData = {
            status: 'Discharge-Pending',
            clinicalSummary: {
                diagnosis: diagnosis || "",
                investigation: investigation || "",
                treatmentResult: treatmentResult || "",
                dischargeNote: dischargeNote || "",
                dischargedAt: now,
                uploadedReports: reportPaths // 👈 Saved multiple files paths array securely!
            }
        };

        // Push Discharged state to timeline
        appointmentObj.treatmentHistory.push({
            fromDoctorId: req.user.id,
            action: 'Discharged',
            notes: "Clinical discharge summary and medical reports submitted.",
            timestamp: now
        });

        // 3. Safe DB atomic update
        const updatedAppt = await Appointment.findByIdAndUpdate(
            appointmentId,
            { 
                $set: updateData,
                $push: { treatmentHistory: appointmentObj.treatmentHistory[appointmentObj.treatmentHistory.length - 1] } 
            },
            { new: true, runValidators: true }
        );

        res.json({ 
            success: true, 
            message: "Discharge summary & medical reports submitted successfully.", 
            data: updatedAppt 
        });

    } catch (error) { 
        console.error("Discharge summary error:", error);
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
        const { appointmentId, observation, patientCondition, priorityRating } = req.body;
        const specialistId = req.user.id;

        // Can strictly submit feedback ONLY if treatment is currently active ('In-Progress')
        const appointment = await Appointment.findOne({ 
            _id: appointmentId, 
            "bedsideCareTeam.doctorId": specialistId,
            "bedsideCareTeam.status": "In-Progress" 
        });

        if (!appointment) {
            return res.status(403).json({ success: false, message: "Unauthorized: Aapka treatment shift active (In-Progress) nahi hai." });
        }

        // Block modifications if treatment already ended
        if (['Discharge-Pending', 'Completed'].includes(appointment.status)) {
            return res.status(400).json({ 
                success: false, 
                message: "Clinical Block: Patient ka treatment officially end ho chuka hai. Ab aap record change nahi kar sakte." 
            });
        }

        // Find specialist object in array
        const careTeamObj = appointment.bedsideCareTeam.find(d => d.doctorId.toString() === specialistId);
        
        // Safeguard array initialization to prevent undefined errors
        if (!careTeamObj.specialistFeedback) {
            careTeamObj.specialistFeedback = [];
        }

        // 🚀 FIX: Appending (Pushing) new feedback instead of overwriting existing object
        careTeamObj.specialistFeedback.push({
            observation: observation || "",
            patientCondition: patientCondition || "",
            priorityRating: priorityRating || 'Routine',
            submittedAt: new Date()
        });

        await appointment.save();
        res.json({ success: true, message: "Clinical observation feedback appended successfully. Status remains In-Progress!" });

    } catch (error) {
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

// --- GET DYNAMIC CASE LISTINGS (Updated with Bedside & Pending Bedside tab filters) ---
const getAssignedCases = async (req, res) => {
    try {
        const { type, status, tab = 'active' } = req.query; // tab: 'active', 'pending', 'discharge', 'history', 'bedside', 'pending-bedside'
        let query = {};

        // A. Primary active patients on my duty
        if (tab === 'active') {
            query = { 
                doctorId: req.user.id, 
                pendingDoctorId: null,
                status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] }
            };
        } 
        // B. Dynamic ready for discharge patients
        else if (tab === 'discharge') {
            query = {
                doctorId: req.user.id,
                pendingDoctorId: null,
                status: 'Discharge-Pending'
            };
        }
        // C. Incoming permanent handover requests waiting for my acceptance
        else if (tab === 'pending') {
            query = { pendingDoctorId: req.user.id };
        } 
        // D. Active bedside cases where I am added as specialist & accepted
        else if (tab === 'bedside') {
            query = {
                "bedsideCareTeam.doctorId": req.user.id,
                "bedsideCareTeam.status": "Accepted",
                status: { $ne: "Completed" }
            };
        }
        // E. Incoming pending bedside help requests waiting for my response
        else if (tab === 'pending-bedside') {
            query = {
                "bedsideCareTeam.doctorId": req.user.id,
                "bedsideCareTeam.status": "Pending"
            };
        }
        // F. My Complete treated history (Both main doctor and ever involved specialists)
        else if (tab === 'history') {
            query = {
                $and: [
                    {
                        $or: [
                            { "treatmentHistory.fromDoctorId": req.user.id },
                            { "treatmentHistory.toDoctorId": req.user.id },
                            { "bedsideCareTeam.doctorId": req.user.id }
                        ]
                    },
                    {
                        $or: [
                            { doctorId: { $ne: req.user.id } },
                            { status: 'Completed' }
                        ]
                    }
                ]
            };
        }

        if (type === 'Emergency') query.triageLevel = 'Emergency';
        if (type === 'Admission') query.bookingType = 'Admission';
        if (status) query.status = status;

        const cases = await Appointment.find(query)
            .populate('userId', 'name profilePic phone age gender')
            .sort({ updatedAt: -1 });

        res.json({ success: true, count: cases.length, data: cases });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- GET PATIENT DETAILS (Updated with populated Bedside team profiles) ---
const getPatientDetails = async (req, res) => {
    try {
        const patient = await Appointment.findById(req.params.id)
            .populate('userId', 'name profilePic phone age gender bloodGroup')
            .populate('bedId', 'bedNumber pricePerDay')
            .populate({
                path: 'treatmentHistory.fromDoctorId',
                select: 'name speciality profileImage'
            })
            .populate({
                path: 'treatmentHistory.toDoctorId',
                select: 'name speciality profileImage'
            })
            // Populate Bedside team doctor info dynamically
            .populate({
                path: 'bedsideCareTeam.doctorId',
                select: 'name speciality profileImage dutyStatus'
            });

        if (!patient) return res.status(404).json({ message: "Patient not found" });
        res.json({ success: true, data: patient });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// --- API: GET PRINTABLE DIGITAL DISCHARGE SUMMARY (Figma Print Sheet Aligned) ---
const getPrintableDischargeSummary = async (req, res) => {
    try {
        const { id } = req.params; // Appointment/Admission ID

        // 1. Fetch Appointment with deep populated fields
        const appt = await Appointment.findById(id)
            .populate('userId', 'name phone email profilePic age gender country state city address')
            .populate('hospitalId', 'name address city state zipCode hospitalImage')
            .populate('doctorId', 'name speciality qualification')
            .populate({
                path: 'bedsideCareTeam.doctorId',
                select: 'name speciality qualification'
            });

        if (!appt) {
            return res.status(404).json({ success: false, message: "Admission Record Not Found." });
        }

        // 2. Fetch the corresponding Prescription medicines array
        const prescription = await Prescription.findOne({ appointmentId: id }).sort({ createdAt: -1 });

        // 3. Construct Figma Sheet JSON Structure
        const dynamicHandoffDoctors = appt.bedsideCareTeam
            .filter(member => member.status === 'Completed' || member.status === 'Accepted' || member.status === 'In-Progress')
            .map(member => ({
                name: member.doctorId?.name || "Specialist",
                department: `Department of ${member.doctorId?.speciality || 'Medicine'}`
            }));

        const figmaDataSheet = {
            // --- FIGMA SHEET HEADER ---
            header: {
                hospitalName: appt.hospitalId?.name || "RADIUS HOSPITAL",
                hospitalAddress: appt.hospitalId?.address || "Mohali, Punjab",
                hospitalLogo: appt.hospitalId?.hospitalImage?.[0] || null,
                leadDoctor: {
                    name: appt.doctorId?.name || "Dr. Deepak Joshi",
                    title: `Professor & Head: Department of ${appt.doctorId?.speciality || 'Medicine'}`,
                    qualification: appt.doctorId?.qualification || "MD"
                },
                collaborativeDoctors: dynamicHandoffDoctors // Lists all involved bedside specialists
            },

            // --- FIGMA PATIENT DETAILS CARD ---
            patientDetails: {
                appointmentId: appt.bookingId,
                name: appt.userId?.name || "N/A",
                address: appt.userId?.address || "Mohali, Punjab",
                gender: appt.userId?.gender || "Male",
                age: appt.userId?.age || 30,
                dateOfAdmission: appt.startDate ? moment(appt.startDate).format("YYYY-MM-DD") : "N/A",
                dateOfDischarge: appt.endDate ? moment(appt.endDate).format("YYYY-MM-DD") : "N/A",
                department: `Department of ${appt.doctorId?.speciality || 'Medicine'}, Unit - 1`,
                paymentStatus: appt.paymentStatus || "Paid",
                paymentType: appt.paymentMethod || "UPI (Google Pay)",
                chiefComplaints: appt.clinicalSummary?.chiefComplaint || appt.patients?.[0]?.reasonForVisit || "N/A",
                diagnosis: appt.clinicalSummary?.diagnosis || "N/A",
                conditionDuringAdmission: appt.clinicalSummary?.triagePriority || appt.triageLevel || "Stable",
                conditionDuringDischarge: appt.clinicalSummary?.treatmentResult || "Recovered & Stable"
            },

            // --- CLINICAL NOTES ---
            clinicalNotes: appt.clinicalSummary?.admissionNote || "Patient was admitted under cardiac monitoring desk, treated with standard formulations and discharged clinically stable.",

            // --- FIGMA MEDICINE TABLE ARRAY ---
            medications: prescription ? prescription.medicines.map((med, idx) => ({
                sNo: String(idx + 1).padStart(2, '0'),
                medicineName: med.name,
                dose: med.dosage, // e.g. "1 - 0 - 1"
                time: med.frequency, // e.g. "Morning - Evening"
                duration: med.duration // e.g. "5 Days"
            })) : [],

            // --- FOLLOW UP INSTRUCTIONS ---
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
const getDoctorHistory = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { page = 1, limit = 10, search } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Fetching cases where this doctor was ever involved (Primary, Handover sender/receiver, or Bedside specialist)
        // AND the case is either fully Completed or currently transferred to another primary doctor
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
                        { doctorId: { $ne: doctorId } }, // currently transferred away
                        { status: 'Completed' }          // or fully discharged/completed
                    ]
                }
            ]
        };

        // Advanced Search handler
        if (search) {
            const isBookingId = search.toUpperCase().startsWith('HKH-') || search.toUpperCase().startsWith('HK-');
            
            if (isBookingId) {
                query.bookingId = { $regex: search, $options: 'i' };
            } else {
                // If searched by Patient Name
                const matchedUsers = await User.find({
                    name: { $regex: search, $options: 'i' }
                }).select('_id');
                const userIds = matchedUsers.map(u => u._id);
                query.userId = { $in: userIds };
            }
        }

        const totalRecords = await Appointment.countDocuments(query);

        const history = await Appointment.find(query)
            .populate('userId', 'name phone email profilePic age gender')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay',
                populate: { path: 'wardId', select: 'name type' }
            })
            .sort({ updatedAt: -1 }) // Sorted by latest activity
            .skip(skip)
            .limit(parseInt(limit));

        res.json({
            success: true,
            totalRecords,
            totalPages: Math.ceil(totalRecords / parseInt(limit)),
            currentPage: parseInt(page),
            count: history.length,
            data: history
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// --- 14. GET PENDING WARD ADMISSIONS (NEW API - Waiting for Doctor Assignment) ---
const getPendingAdmissions = async (req, res) => {
    try {
        const hospitalId = req.user.hospitalId;
        if (!hospitalId) {
            return res.status(400).json({ 
                success: false, 
                message: "Unauthorized: Aap kisi hospital se associated nahi hain." 
            });
        }

        // Find admissions physically in a bed (In-Progress) but awaiting doctor assignment
        const admissions = await Appointment.find({
            hospitalId,
            bookingType: 'Admission',
            doctorId: null,
            status: 'In-Progress' 
        })
        .populate('userId', 'name phone age gender profilePic')
        .populate('bedId', 'bedNumber pricePerDay');

        res.json({ success: true, count: admissions.length, data: admissions });
    } catch (error) {
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

// --- 16. REJECT/DECLINE PATIENT HANDOVER (Doctor B Action - NEW API) ---
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

        // 1. Clear pending transfer state (Patient goes back to Doctor A's active queue instantly)
        appointment.pendingDoctorId = null;
        
        // 2. Push rejection log to timeline history securely
        appointment.treatmentHistory.push({
            fromDoctorId: doctorId, // Doctor B
            toDoctorId: senderDoctorId, // Doctor A
            action: 'Transfer-Initiated', // Kept schema enum compatible
            notes: `Transfer Rejected by Dr. ${req.user.name}. Reason: ${reason || 'Shift duty mismatch'}`,
            timestamp: new Date()
        });

        await appointment.save();
        res.json({ success: true, message: "Handover transfer declined successfully. Case returned to sender." });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { 
    getMyDoctorProfile,
    updateDoctorProfile,
    getDoctorHistory,

    getPendingAdmissions,
    takeChargeOfAdmission ,
    rejectTransfer,

    getSpecializations,
    getDocDashboard, getAssignedCases, getPatientDetails, 
    processPrescription, transferPatient, acceptTransfer,
     getHospitalColleagues,
    submitDischargeSummary,uploadPatientReports, updateDutyStatus, getMedicineList, updateClinicalSummary,

    requestBedsideSpecialist,respondToBedsideRequest,startSpecialistCare,submitSpecialistFeedback,completeSpecialistCare,
    getPrintableDischargeSummary
};