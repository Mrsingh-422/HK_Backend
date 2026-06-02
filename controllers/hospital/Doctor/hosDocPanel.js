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
            });

        if (!patient) return res.status(404).json({ message: "Patient not found" });
        res.json({ success: true, data: patient });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 4. CREATE PRESCRIPTION (Fixed Array Safe Map Logic) ---
const processPrescription = async (req, res) => {
    try {
        const { appointmentId, diagnosis, medicines, advice } = req.body;

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) return res.status(404).json({ message: "Appointment record not found" });
        
        // FIX: Safe array converter if diagnosis comes as a string from frontend
        const diagnosisArray = Array.isArray(diagnosis) ? diagnosis : (diagnosis ? [diagnosis] : []);

        const prescription = await Prescription.create({
            appointmentId,
            doctorId: req.user.id,
            userId: appointment.userId,
            diagnosis: diagnosisArray,
            medicines, // Maps [{name, dosage, frequency, duration, instructions}] dynamically
            additionalNotes: advice
        });

        res.status(201).json({ success: true, message: "Prescription added", data: prescription });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. TRANSFER PATIENT HANDOVER (Doctor A Panel)
const transferPatient = async (req, res) => {
    try {
        const { appointmentId, toDoctorId, reason, priority } = req.body;

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) return res.status(404).json({ message: "Case not found" });

        // Verify target doctor is from the same hospital and is active
        const targetDoctor = await Doctor.findOne({ 
            _id: toDoctorId, 
            hospitalId: req.user.hospitalId, 
            role: 'hospital-doctor',
            isActive: true 
        });

        if (!targetDoctor) {
            return res.status(400).json({ success: false, message: "Target doctor not found in this hospital." });
        }

        // Set pending doctor and status
        appointment.pendingDoctorId = toDoctorId;
        appointment.triageLevel = priority || appointment.triageLevel;
        
        // Push handover action to treatment audit trail
        appointment.treatmentHistory.push({
            fromDoctorId: req.user.id,
            toDoctorId: toDoctorId,
            action: 'Transfer-Initiated',
            notes: reason || "Shift Handover",
            timestamp: new Date()
        });

        await appointment.save();
        res.json({ success: true, message: "Patient handover initiated. Pending acceptance." });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. ACCEPT PATIENT HANDOVER (Doctor B Panel - NEW API)
const acceptTransfer = async (req, res) => {
    try {
        const { appointmentId } = req.body;

        const appointment = await Appointment.findOne({ _id: appointmentId, pendingDoctorId: req.user.id });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "No pending transfer request found for you." });
        }

        const oldDoctorId = appointment.doctorId;

        // Make Doctor B the primary doctor
        appointment.doctorId = req.user.id;
        appointment.pendingDoctorId = null; // Clear pending state
        appointment.status = 'In-Progress'; // Mark active

        // Push acceptance audit trail
        appointment.treatmentHistory.push({
            fromDoctorId: oldDoctorId,
            toDoctorId: req.user.id,
            action: 'Transfer-Accepted',
            notes: "Patient accepted on duty roster.",
            timestamp: new Date()
        });

        await appointment.save();
        res.json({ success: true, message: "Patient transfer accepted successfully.", data: appointment });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. GET ASSIGNED & PENDING INCOMING CASES (Updated)
const getAssignedCases = async (req, res) => {
    try {
        const { type, status } = req.query; 
        
        // Find both active cases AND incoming pending transfers for this doctor
        let query = {
            $or: [
                { doctorId: req.user.id, pendingDoctorId: null }, // Active cases
                { pendingDoctorId: req.user.id } // Incoming pending transfers
            ]
        };

        if (type === 'Emergency') query.triageLevel = 'Emergency';
        if (type === 'Admission') query.bookingType = 'Admission';
        if (status) query.status = status;

        const cases = await Appointment.find(query)
            .populate('userId', 'name profilePic phone age gender')
            .sort({ updatedAt: -1 });

        res.json({ success: true, data: cases });
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

// --- 7. DISCHARGE SUMMARY ---
// --- 7. DISCHARGE SUMMARY (Fixed: Setting status to 'Discharge-Pending' for billing sync) ---
const submitDischargeSummary = async (req, res) => {
    try {
        const { appointmentId, diagnosis, investigation, treatmentResult, dischargeNote } = req.body;

        const updateData = {
            status: 'Discharge-Pending', // 👈 FIXED: Clinical summary submitted, waiting for Admin bill closure
            clinicalSummary: {
                diagnosis: diagnosis || "",
                investigation: investigation || "",
                treatmentResult: treatmentResult || "",
                dischargeNote: dischargeNote || "",
                dischargedAt: new Date()
            }
        };

        const appointment = await Appointment.findByIdAndUpdate(
            appointmentId,
            { $set: updateData },
            { new: true, runValidators: true } 
        );

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Case not found" });
        }

        res.json({ 
            success: true, 
            message: "Discharge summary submitted. Pending Admin billing closure.", 
            data: appointment 
        });

    } catch (error) { 
        console.error("Discharge summary error:", error);
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
const getMedicineList = async (req, res) => {
    try {
        const medicines = ["Insulin 40IU/ml", "Paracetamol 500mg", "Telmisartan 40mg"];
        res.json({ success: true, data: medicines });
    } catch (error) { res.status(500).json({ message: error.message }); }
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

module.exports = { 
    getSpecializations,
    getDocDashboard, getAssignedCases, getPatientDetails, 
    processPrescription, transferPatient, acceptTransfer,
     getHospitalColleagues,
    submitDischargeSummary, updateDutyStatus, getMedicineList, updateClinicalSummary
};