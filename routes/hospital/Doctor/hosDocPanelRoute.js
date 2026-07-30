const router = require('express').Router();
const { protect } = require('../../../middleware/authMiddleware');
const { doctorDocUploads,doctorReportUploads,dietPlanUploads,hospitalPrescriptionUploads } = require('../../../middleware/multer');
const { 
    getMyDoctorProfile,changeHospitalDoctorPassword,
        updateDoctorProfile,getLatestDoctorProfileRequest,
        getDoctorHistory, 
        getPendingAdmissions,
    takeChargeOfAdmission ,rejectTransfer,

    getDocDashboard, 
    getAssignedCases, 
    getPatientDetails, getSpecializations,
    processPrescription, 
    getHospitalColleagues, 
    transferPatient, acceptTransfer,
    submitDischargeSummary,verifyDischargeSheet, uploadPatientReports,
    updateDutyStatus,getMedicineList, updateClinicalSummary,

    requestBedsideSpecialist,respondToBedsideRequest,startSpecialistCare,submitSpecialistFeedback,completeSpecialistCare,
    getPrintableDischargeSummary,
    doctorSelfAssignCase
    
} = require('../../../controllers/hospital/Doctor/hosDocPanel');

// Base: /hospital-doctor/panel

router.get('/profile', protect('hospital-doctor'), getMyDoctorProfile);
router.patch('/profile/change-password', protect('hospital-doctor'), changeHospitalDoctorPassword);
router.put('/profile/update', protect('hospital-doctor'), doctorDocUploads, updateDoctorProfile);
router.get('/profile/update-status', protect('hospital-doctor'), getLatestDoctorProfileRequest);




router.get('/dashboard', protect('hospital-doctor'), getDocDashboard);
router.get('/cases', protect('hospital-doctor'), getAssignedCases);
router.get('/case-details/:id', protect('hospital-doctor'), getPatientDetails);

router.post(
    '/prescription/add', 
    protect('hospital-doctor'), 
    hospitalPrescriptionUploads, // 👈 Replaced dietPlanUploads here
    processPrescription
);
router.get('/colleagues', protect('hospital-doctor'), getHospitalColleagues); // For transfer dropdown
router.post('/case/transfer', protect('hospital-doctor'), transferPatient);
router.post('/case/accept-transfer', protect('hospital-doctor'), acceptTransfer); // 👈 ADD THIS ROUTE


router.post('/case/discharge-summary', protect('hospital-doctor'), submitDischargeSummary);

router.get('/verify-discharge/:id', verifyDischargeSheet);

router.post('/case/upload-reports/:id', protect('hospital-doctor'), doctorReportUploads, uploadPatientReports);
router.patch('/status/duty-toggle', protect('hospital-doctor'), updateDutyStatus); // NO 403 ERROR NOW

router.get('/medicines', protect('hospital-doctor'), getMedicineList);
router.put('/case/clinical-summary/:id', protect('hospital-doctor'), updateClinicalSummary);
router.get('/specializations', protect('hospital-doctor'), getSpecializations);
router.post('/case/discharge-summary', protect('hospital-doctor'), doctorReportUploads, submitDischargeSummary);
router.get('/cases/history-list', protect('hospital-doctor'), getDoctorHistory);



// --- BEDSIDE CARE TEAM ROUTES ---
router.post('/case/bedside-request', protect('hospital-doctor'), requestBedsideSpecialist); // Invite Specialist
router.post('/case/bedside-respond', protect('hospital-doctor'), respondToBedsideRequest);   // Accept/Reject Invitation
router.post('/case/bedside-start', protect('hospital-doctor'), startSpecialistCare); // 👈 ADD THIS ROUTE
router.post('/case/bedside-feedback', protect('hospital-doctor'), submitSpecialistFeedback);  // Submit Specialist Observations
router.post('/case/bedside-complete', protect('hospital-doctor'), completeSpecialistCare); // 👈 ADD THIS ROUTE

router.get('/case/discharge-summary/print/:id', protect('hospital-doctor'), getPrintableDischargeSummary); // 👈 ADD THIS ROUTE
router.get('/cases/pending-admissions', protect('hospital-doctor'), getPendingAdmissions); // 👈 ADD THIS ROUTE
router.post('/case/take-charge', protect('hospital-doctor'), takeChargeOfAdmission);  
router.post('/case/reject-transfer', protect('hospital-doctor'), rejectTransfer); // 👈 ADD THIS ROUTE

router.post('/case/self-assign', protect('hospital-doctor'), doctorSelfAssignCase); // 👈 ADD THIS ROUTE






module.exports = router;