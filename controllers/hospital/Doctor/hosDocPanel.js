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

// --- 2. CASE LISTING ---
const getAssignedCases = async (req, res) => {
    try {
        const { type, status } = req.query; 
        let query = { doctorId: req.user.id };

        if (type === 'Emergency') query.triageLevel = 'Emergency';
        if (type === 'Admission') query.bookingType = 'Admission';
        if (status) query.status = status;

        const cases = await Appointment.find(query)
            .populate('userId', 'name profilePic phone age gender')
            .sort({ updatedAt: -1 });

        res.json({ success: true, data: cases });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 3. GET PATIENT DETAILS ---
const getPatientDetails = async (req, res) => {
    try {
        const patient = await Appointment.findById(req.params.id)
            .populate('userId', 'name profilePic phone age gender bloodGroup')
            .populate('bedId', 'bedNumber pricePerDay');

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

// --- 5. TRANSFER/ASSIGN OTHER DOCTOR (Fixed Security Role check) ---
const transferPatient = async (req, res) => {
    try {
        const { appointmentId, toDoctorId, reason, condition, priority } = req.body;

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) return res.status(404).json({ message: "Case not found" });

        // FIX: Strictly verify target doctor is from the SAME hospital and is a 'hospital-doctor'
        const targetDoctor = await Doctor.findOne({ 
            _id: toDoctorId, 
            hospitalId: req.user.hospitalId, 
            role: 'hospital-doctor',
            isActive: true 
        });

        if (!targetDoctor) {
            return res.status(400).json({ 
                success: false, 
                message: "Transfer Failed: Target doctor aapke hospital se associated ya active nahi hai." 
            });
        }

        // Update Appointment with New Doctor Details
        appointment.doctorId = toDoctorId;
        appointment.triageLevel = priority || appointment.triageLevel;
        appointment.status = 'In-Progress'; 

        await appointment.save();
        res.json({ success: true, message: "Patient transferred successfully" });
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
const submitDischargeSummary = async (req, res) => {
    try {
        const { appointmentId, diagnosis, investigation, treatmentResult, dischargeNote } = req.body;

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) return res.status(404).json({ message: "Case not found" });
        
        // Final Summary save logic
        appointment.clinicalSummary = {
            diagnosis,
            investigation,
            treatmentResult,
            dischargeNote,
            dischargedAt: new Date()
        };
        appointment.status = 'Confirmed'; // Marked as ready for discharge (Admin will finalize bill)

        await appointment.save();
        res.json({ success: true, message: "Discharge summary submitted. Pending Admin billing." });
    } catch (error) { res.status(500).json({ message: error.message }); }
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
    processPrescription, transferPatient, getHospitalColleagues,
    submitDischargeSummary, updateDutyStatus, getMedicineList, updateClinicalSummary
};