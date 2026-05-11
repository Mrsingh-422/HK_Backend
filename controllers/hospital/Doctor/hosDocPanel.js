const Appointment = require('../../../models/Appointment');
const Doctor = require('../../../models/Doctor');
const Prescription = require('../../../models/Prescription');
const mongoose = require('mongoose');

// --- 1. DASHBOARD CONTROLLER (Screenshot 2) ---
// Isme real-time counts aayenge jo sirf is doctor se linked hain
const getDocDashboard = async (req, res) => {
    try {
        const doctorId = req.user.id;
        
        const stats = {
            totalCases: await Appointment.countDocuments({ doctorId }),
            requests: await Appointment.countDocuments({ doctorId, status: 'Hospital-Pending' }),
            active: await Appointment.countDocuments({ doctorId, status: 'In-Progress' })
        };

        // Hospital specific counts for icons
        const emergencyCount = await Appointment.countDocuments({ doctorId, triageLevel: 'Emergency', status: 'In-Progress' });
        const admissionCount = await Appointment.countDocuments({ doctorId, bookingType: 'Admission', status: 'In-Progress' });
        const transferCount = await Appointment.countDocuments({ doctorId, status: 'Hospital-Pending' }); // Incoming transfers

        res.json({
            success: true,
            welcomeName: req.user.name,
            dutyStatus: req.user.dutyStatus, // On Duty, Off Duty, etc.
            stats,
            grid: { emergencyCount, admissionCount, transferCount }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. CASE LISTING (Screenshot 11, 13) ---
const getAssignedCases = async (req, res) => {
    try {
        const { type, status } = req.query; // type: 'Emergency'/'Admission', status: 'In-Progress'/'Completed'
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

// --- 3. GET PATIENT FULL DETAILS (Screenshot 11 Patient Details) ---
const getPatientDetails = async (req, res) => {
    try {
        const patient = await Appointment.findById(req.params.id)
            .populate('userId', 'name profilePic phone age gender bloodGroup')
            .populate('bedId', 'bedNumber pricePerDay');

        if (!patient) return res.status(404).json({ message: "Patient not found" });

        res.json({ success: true, data: patient });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 4. CREATE PRESCRIPTION (Screenshot 18, 19) ---
const processPrescription = async (req, res) => {
    try {
        const { appointmentId, diagnosis, medicines, advice } = req.body;
        // medicines format: [{ name: "Insulin", dosage: "1-1-1", duration: "30 days" }]

        const appointment = await Appointment.findById(appointmentId);
        
        const prescription = await Prescription.create({
            appointmentId,
            doctorId: req.user.id,
            userId: appointment.userId,
            diagnosis,
            medicines,
            additionalNotes: advice
        });

        res.status(201).json({ success: true, message: "Prescription added", data: prescription });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 5. TRANSFER/ASSIGN OTHER DOCTOR (Screenshot 24, 25) ---
/* 
   Logic Explanation: Hospital mein Senior doctor ya Roster change hone par 
   ek doctor dusre ko patient hand-over karta hai. 
*/
const transferPatient = async (req, res) => {
    try {
        const { appointmentId, toDoctorId, reason, condition, priority } = req.body;

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) return res.status(404).json({ message: "Case not found" });

        // Update Appointment with New Doctor
        appointment.doctorId = toDoctorId;
        appointment.triageLevel = priority || appointment.triageLevel;
        // Add to history (Professional Audit)
        appointment.status = 'In-Progress'; 

        await appointment.save();
        res.json({ success: true, message: "Patient transferred successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 6. GET COLLEAGUES (For Transfer Dropdown) ---
// Doctor ko sirf apne hospital ke baaki doctors dikhne chahiye
const getHospitalColleagues = async (req, res) => {
    try {
        const doctors = await Doctor.find({ 
            hospitalId: req.user.hospitalId, 
            _id: { $ne: req.user.id }, // Khud ko chorkar
            isActive: true 
        }).select('name speciality profileImage dutyStatus');

        res.json({ success: true, data: doctors });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 7. DISCHARGE SUMMARY (Screenshot 21, 22) ---
const submitDischargeSummary = async (req, res) => {
    try {
        const { appointmentId, diagnosis, investigation, treatmentResult, dischargeNote } = req.body;

        const appointment = await Appointment.findById(appointmentId);
        
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

// --- 8. DUTY STATUS TOGGLE (FIXED LOGIC) ---
const updateDutyStatus = async (req, res) => {
    try {
        const { status } = req.body; // 'On Duty', 'Off Duty', 'On Leave', 'Busy'
        
        // Hum isActive ko nahi chedenge, sirf dutyStatus badlenge
        const doctor = await Doctor.findByIdAndUpdate(
            req.user.id, 
            { dutyStatus: status }, 
            { new: true }
        );

        res.json({ success: true, message: `Status updated to ${status}`, current: doctor.dutyStatus });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// 1. GET MEDICINE TEMPLATES (Screenshot 18 Dropdown)
const getMedicineList = async (req, res) => {
    try {
        // Isme aap Pharmacy model ya global Medicine model use karenge
        const medicines = ["Insulin 40IU/ml", "Paracetamol 500mg", "Telmisartan 40mg"];
        res.json({ success: true, data: medicines });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. UPDATE ADMISSION CLINICAL SUMMARY (Screenshot 22)
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
    getDocDashboard, getAssignedCases, getPatientDetails, 
    processPrescription, transferPatient, getHospitalColleagues,
    submitDischargeSummary, updateDutyStatus, getMedicineList, updateClinicalSummary
};