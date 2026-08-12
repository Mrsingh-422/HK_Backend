const router = require('express').Router();
const { protect } = require('../../../middleware/authMiddleware');
const { doctorDocUploads,doctorReportUploads,dietPlanUploads,hospitalPrescriptionUploads,hospitalDischargeFieldsUpload } = require('../../../middleware/multer');
const { 
    getMyDoctorProfile,changeHospitalDoctorPassword,
        updateDoctorProfile,getLatestDoctorProfileRequest,
        getDoctorHistory, 
        getPendingAdmissions,
    takeChargeOfAdmission ,rejectTransfer,

    getDocDashboard, 
    getAssignedCases, getPrescriptionsByAppointment,
    deletePrescriptionById,
    getRawDischargeSummary,
    getPatientDetails, getSpecializations,
    processPrescription, 
    getHospitalColleagues, 
    transferPatient, acceptTransfer,
    submitDischargeSummary,verifyDischargeSheet, uploadPatientReports,
    updateDutyStatus,getMedicineList, updateClinicalSummary,

    requestBedsideSpecialist,respondToBedsideRequest,startSpecialistCare,submitSpecialistFeedback,getCollaborativeMedications,completeSpecialistCare,
    getPrintableDischargeSummary,
    doctorSelfAssignCase,addPrimaryClinicalLog,addActiveMedication,stopActiveMedication
    
} = require('../../../controllers/hospital/Doctor/hosDocPanel');

// Base: /hospital-doctor/panel

// ==========================================
// 1. PROFILE & SECURITY SECTION
// ==========================================
router.get('/profile', protect('hospital-doctor'), getMyDoctorProfile);
router.patch('/profile/change-password', protect('hospital-doctor'), changeHospitalDoctorPassword);
router.put('/profile/update', protect('hospital-doctor'), doctorDocUploads, updateDoctorProfile);
router.get('/profile/update-status', protect('hospital-doctor'), getLatestDoctorProfileRequest);

// ==========================================
// 2. DASHBOARD & CASE TRYS
// ==========================================
router.get('/dashboard', protect('hospital-doctor'), getDocDashboard);
router.get('/cases', protect('hospital-doctor'), getAssignedCases);
router.get('/case-details/:id', protect('hospital-doctor'), getPatientDetails);
router.get('/cases/history-list', protect('hospital-doctor'), getDoctorHistory);

// ==========================================
// 3. WARD ADMISSIONS & SHIFT TRANSFERS
// ==========================================
router.get('/cases/pending-admissions', protect('hospital-doctor'), getPendingAdmissions); 
router.post('/case/take-charge', protect('hospital-doctor'), takeChargeOfAdmission);  
router.post('/case/self-assign', protect('hospital-doctor'), doctorSelfAssignCase); 

router.get('/colleagues', protect('hospital-doctor'), getHospitalColleagues); // For transfer dropdown
router.post('/case/transfer', protect('hospital-doctor'), transferPatient);
router.post('/case/accept-transfer', protect('hospital-doctor'), acceptTransfer); 
router.post('/case/reject-transfer', protect('hospital-doctor'), rejectTransfer); 

// ==========================================
// 4. PRESCRIPTIONS & DISCHARGE SUMMARIES
// ==========================================
// ==========================================
// 4. PRESCRIPTIONS & DISCHARGE SUMMARIES
// ==========================================
router.post('/prescription/add', protect('hospital-doctor'), hospitalPrescriptionUploads, processPrescription);

// 🚀 NEW: Get existing prescriptions for an appointment
router.get('/prescriptions/:appointmentId', protect('hospital-doctor'), getPrescriptionsByAppointment);

// 🚀 NEW: Delete wrongly added prescription
router.delete('/prescription/:id', protect('hospital-doctor'), deletePrescriptionById);
router.post(
    '/case/discharge-summary', 
    protect('hospital-doctor'), 
    hospitalDischargeFieldsUpload, // Handles both 'dischargePdf' and 'clinicalReports' arrays simultaneously
    submitDischargeSummary
);

router.get('/case/discharge-summary/:id', protect('hospital-doctor'), getRawDischargeSummary);
router.get('/case/discharge-summary/print/:id', protect('hospital-doctor'), getPrintableDischargeSummary); 
router.get('/verify-discharge/:id', verifyDischargeSheet);

// ==========================================
// 5. DIAGNOSTICS & RESOURCE TOOLS
// ==========================================
router.post('/case/upload-reports/:id', protect('hospital-doctor'), doctorReportUploads, uploadPatientReports);
router.patch('/status/duty-toggle', protect('hospital-doctor'), updateDutyStatus); 
router.get('/medicines', protect('hospital-doctor'), getMedicineList);
router.put('/case/clinical-summary/:id', protect('hospital-doctor'), updateClinicalSummary);
router.get('/specializations', protect('hospital-doctor'), getSpecializations);
// 🚨 Duplicate 'discharge-summary' line has been successfully removed from here

// ==========================================
// 6. BEDSIDE CARE SPECIALISTS CO-DOCTORS
// ==========================================
router.post('/case/bedside-request', protect('hospital-doctor'), requestBedsideSpecialist); 
router.post('/case/bedside-respond', protect('hospital-doctor'), respondToBedsideRequest);   
router.post('/case/bedside-start', protect('hospital-doctor'), startSpecialistCare); 
router.post('/case/bedside-feedback', protect('hospital-doctor'), submitSpecialistFeedback);
router.get('/case/bedside-medications/:appointmentId', protect('hospital-doctor'), getCollaborativeMedications);
router.post('/case/bedside-complete', protect('hospital-doctor'), completeSpecialistCare); 





router.post('/case/clinical-log/add', protect('hospital-doctor'), addPrimaryClinicalLog);
// --- IN-PATIENT ACTIVE MEDICATION PATHS ---
router.post('/case/active-medication/add', protect('hospital-doctor'), addActiveMedication);
router.patch('/case/active-medication/stop', protect('hospital-doctor'), stopActiveMedication);

module.exports = router;