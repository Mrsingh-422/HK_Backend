const router = require('express').Router();
const { protect } = require('../../../middleware/authMiddleware');
const { doctorDocUploads } = require('../../../middleware/multer');
const { 
    getMyDoctorProfile,
        updateDoctorProfile,

    getDocDashboard, 
    getAssignedCases, 
    getPatientDetails, 
    processPrescription, 
    getHospitalColleagues, 
    transferPatient, acceptTransfer,
    submitDischargeSummary, 
    updateDutyStatus,getMedicineList, updateClinicalSummary,

    requestBedsideSpecialist,respondToBedsideRequest,submitSpecialistFeedback
    
} = require('../../../controllers/hospital/Doctor/hosDocPanel');

// Base: /hospital-doctor/panel

router.get('/profile', protect('hospital-doctor'), getMyDoctorProfile);
router.put('/profile/update', protect('hospital-doctor'), doctorDocUploads, updateDoctorProfile);




router.get('/dashboard', protect('hospital-doctor'), getDocDashboard);
router.get('/cases', protect('hospital-doctor'), getAssignedCases);
router.get('/case-details/:id', protect('hospital-doctor'), getPatientDetails);

router.post('/prescription/add', protect('hospital-doctor'), processPrescription);

router.get('/colleagues', protect('hospital-doctor'), getHospitalColleagues); // For transfer dropdown
router.post('/case/transfer', protect('hospital-doctor'), transferPatient);
router.post('/case/accept-transfer', protect('hospital-doctor'), acceptTransfer); // 👈 ADD THIS ROUTE


router.post('/case/discharge-summary', protect('hospital-doctor'), submitDischargeSummary);

router.patch('/status/duty-toggle', protect('hospital-doctor'), updateDutyStatus); // NO 403 ERROR NOW

router.get('/medicines', protect('hospital-doctor'), getMedicineList);
router.put('/case/clinical-summary/:id', protect('hospital-doctor'), updateClinicalSummary);


// --- BEDSIDE CARE TEAM ROUTES ---
router.post('/case/bedside-request', protect('hospital-doctor'), requestBedsideSpecialist); // Invite Specialist
router.post('/case/bedside-respond', protect('hospital-doctor'), respondToBedsideRequest);   // Accept/Reject Invitation
router.post('/case/bedside-feedback', protect('hospital-doctor'), submitSpecialistFeedback);  // Submit Specialist Observations


module.exports = router;