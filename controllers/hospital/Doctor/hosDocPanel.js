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
            alternatePhone
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
       
        // Handle dynamic nested fees object safely
        if (fees) {
            updates.fees = typeof fees === 'string' ? JSON.parse(fees) : fees;
        }
       
        // Handle dynamic nested consultation status safely
        if (consultationStatus) {
            updates.consultationStatus = typeof consultationStatus === 'string' ? JSON.parse(consultationStatus) : consultationStatus;
        }
 
        // Process new file uploads
        if (req.files && req.files.profileImage && req.files.profileImage[0]) {
            updates.profileImage = `/uploads/doctors/${req.files.profileImage[0].filename}`;
        }

        if (req.files && req.files.signatureImage && req.files.signatureImage[0]) {
            updates.signatureImage = `/uploads/doctors/${req.files.signatureImage[0].filename}`;
        }

        // 🚨 DISK CLEANUP: Delete unapproved files from any existing PENDING update request
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
            // Overwrite and remove old pending requests
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
            advisedInvestigations,   // Matches "Advise Investigation" from image
            adviceGiven,             // Matches "Advice Given" from image
            specialInstructions,     // Matches "Any Special Instruction Given" from image
            nextAppointment          // Matches "Next Appointment" from image
        } = req.body;

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

        // Process dynamic file fields uploaded from multer
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

        const prescription = await Prescription.create({
            appointmentId,
            doctorId: req.user.id,
            userId: appointment.userId,
            diagnosis: diagnosisArray,
            medicines: medicinesArray, 
            additionalNotes: advice || adviceGiven || "",
            
            // New database keys mapped from prescription screenshot
            advisedInvestigations: advisedInvestigations || "None",
            adviceGiven: adviceGiven || "",
            specialInstructions: specialInstructions || "",
            nextAppointment: nextAppointment || "",
            
            // PDF Storage Links
            pdfUrl: prescriptionPdfPath, // Path to compiled prescription layout
            dietPlanPdf: dietPlanPath     // Path to optional patient diet plan PDF
        });

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

        // Close Active Doctor's shift
        const activeShift = appointmentObj.treatmentHistory.find(h => 
            h.toDoctorId && h.toDoctorId.toString() === req.user.id.toString() && !h.endTime
        );
        if (activeShift) {
            activeShift.endTime = now;
            activeShift.durationDisplay = calculateDurationDisplay(activeShift.startTime, now);
        }

        // Extract uploaded additional reports from multer files
        let updatedReports = (appointmentObj.clinicalSummary && appointmentObj.clinicalSummary.uploadedReports) 
            ? appointmentObj.clinicalSummary.uploadedReports 
            : [];
            
        if (req.files && req.files.clinicalReports) {
            const reportPaths = req.files.clinicalReports.map(f => `/uploads/doctor_reports/${f.filename}`);
            updatedReports = [...updatedReports, ...reportPaths];
        }

        // Extract final generated Discharge PDF path from multer files
        let dischargePdfPath = (appointmentObj.clinicalSummary && appointmentObj.clinicalSummary.dischargeSummaryPdf)
            ? appointmentObj.clinicalSummary.dischargeSummaryPdf
            : null;

        if (req.files && req.files.dischargePdf && req.files.dischargePdf[0]) {
            dischargePdfPath = `/uploads/hospital_discharges/${req.files.dischargePdf[0].filename}`;
        }

        // --- DYNAMIC DATA MAPPING ---
        const updateData = {
            status: 'Discharge-Pending', 
            clinicalSummary: {
                diagnosis: body.diagnosis || (appointmentObj.clinicalSummary?.diagnosis) || "",
                investigation: body.investigation || (appointmentObj.clinicalSummary?.investigation) || "",
                treatmentResult: body.treatmentResult || (appointmentObj.clinicalSummary?.treatmentResult) || "",
                dischargeNote: body.dischargeNote || (appointmentObj.clinicalSummary?.dischargeNote) || "",
                dischargedAt: now,
                uploadedReports: updatedReports,

                // Save dynamic preparation keys
                dateOfSurgery: body.dateOfSurgery ? new Date(body.dateOfSurgery) : (appointmentObj.clinicalSummary?.dateOfSurgery || null),
                conditionDuringAdmission: body.conditionDuringAdmission || (appointmentObj.clinicalSummary?.conditionDuringAdmission) || "",
                conditionDuringDischarge: body.conditionDuringDischarge || (appointmentObj.clinicalSummary?.conditionDuringDischarge) || "",

                // 🚨 SAVE THE FINAL COMPILED PDF LINK:
                dischargeSummaryPdf: dischargePdfPath
            }
        };

        appointmentObj.treatmentHistory.push({
            fromDoctorId: req.user.id,
            action: 'Discharged',
            notes: "Clinical discharge summary and medical reports submitted by duty physician.",
            timestamp: now
        });

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
            message: "Discharge summary, clinical files, and final PDF summary recorded successfully.", 
            data: updatedAppt 
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

// --- UPDATE FOR getAssignedCases: Native support for Bedside and Pending-Admissions tabs ---
const getAssignedCases = async (req, res) => {
    try {
        const { type, status, tab = 'active' } = req.query; // tab: 'active', 'pending', 'discharge', 'history', 'bedside', 'pending-bedside', 'pending-admissions'
        let query = {};

        // Case A: Active patients currently assigned to me
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
        // Case D: History Patients
        else if (tab === 'history') {
            query = {
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
            };
        }
        // 🚀 NEW CASE E: Bedside Care (Active/Accepted Specialist Jobs)
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
        // 🚀 NEW CASE F: Pending Bedside (Invites awaiting acceptance)
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
        // 🚀 NEW CASE G: Pending Admissions (Alias link for cases with no assigned doctor)
        else if (tab === 'pending-admissions') {
            query = {
                hospitalId: req.user.hospitalId,
                bookingType: 'Admission',
                doctorId: null,
                status: 'In-Progress'
            };
        }

        // --- SINKING FILTERS (Ambulance vs Direct Admissions) ---
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

        const cases = await Appointment.find(query)
            .populate('userId', 'name profilePic phone age gender')
            .sort({ updatedAt: -1 });

        res.json({ success: true, count: cases.length, data: cases });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 🚀 NEW CONTROLLER: Fetch existing prescriptions for a patient/appointment
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
        const { id } = req.params;

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

        const prescription = await Prescription.findOne({ appointmentId: id }).sort({ createdAt: -1 });

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

        const figmaDataSheet = {
            header: {
                hospitalName: appt.hospitalId?.name || "RADIUS HOSPITAL",
                hospitalAddress: appt.hospitalId?.address || "Mohali, Punjab",
                hospitalLogo: appt.hospitalId?.hospitalImage?.[0] || null,
                leadDoctor: {
                    name: appt.doctorId?.name || "Dr. Deepak Joshi",
                    title: `Professor & Head: Department of ${appt.doctorId?.speciality || 'Medicine'}`,
                    qualification: appt.doctorId?.qualification || "MD"
                },
                collaborativeDoctors: dynamicHandoffDoctors
            },

            // --- ALL 9 KEYS MAPPED TO DYNAMIC DATABASE PROPERTIES ---
            patientDetails: {
                appointmentId: appt.bookingId,
                name: appt.userId?.name || "N/A",
                address: appt.userId?.address || "N/A",
                gender: appt.userId?.gender || "Male",
                age: appt.userId?.age || 30,
                
                // 1. Date of Admission (startDate)
                dateOfAdmission: appt.startDate ? moment(appt.startDate).format("YYYY-MM-DD") : "N/A",
                
                // 2. Department (Dynamic Doctor Specialization)
                department: appt.doctorId?.speciality 
                    ? `Department of ${appt.doctorId.speciality}, Unit - 1` 
                    : "Department of Medicine, Unit - 1",
                
                // 3. Date of Discharge (endDate)
                dateOfDischarge: appt.endDate ? moment(appt.endDate).format("YYYY-MM-DD") : "N/A",
                
                // 4. Date of Surgery (dynamic key)
                dateOfSurgery: appt.clinicalSummary?.dateOfSurgery 
                    ? moment(appt.clinicalSummary.dateOfSurgery).format("YYYY-MM-DD") 
                    : "N/A",
                
                // 5. Insurance Status (drawn from appointment hasInsurance key)
                insuranceStatus: appt.hasInsurance ? "Verified (Cashless)" : "N/A",
                
                // 6. Payment Status (drawn from appointment paymentStatus key)
                paymentStatus: appt.paymentStatus || "Pending",
                
                // 7. Payment Type (formatted logically)
                paymentType: formatPaymentMethod(appt.paymentMethod),
                
                // 8. Condition during Admission
                conditionDuringAdmission: appt.clinicalSummary?.conditionDuringAdmission || "Stable",
                
                // 9. Condition during Discharge
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

    requestBedsideSpecialist,respondToBedsideRequest,startSpecialistCare,submitSpecialistFeedback,completeSpecialistCare,
    getPrintableDischargeSummary,
    doctorSelfAssignCase
};