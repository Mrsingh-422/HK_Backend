const router = require('express').Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getDocDashboard, 
    getAssignedCases, 
    getPatientDetails, 
    processPrescription, 
    getHospitalColleagues, 
    transferPatient, 
    submitDischargeSummary, 
    updateDutyStatus
} = require('../../../controllers/hospital/Doctor/hosDocPanel');

// Base: /hospital-doctor/panel

router.get('/dashboard', protect('hospital-doctor'), getDocDashboard);
router.get('/cases', protect('hospital-doctor'), getAssignedCases);
router.get('/case-details/:id', protect('hospital-doctor'), getPatientDetails);

router.post('/prescription/add', protect('hospital-doctor'), processPrescription);

router.get('/colleagues', protect('hospital-doctor'), getHospitalColleagues); // For transfer dropdown
router.post('/case/transfer', protect('hospital-doctor'), transferPatient);

router.post('/case/discharge-summary', protect('hospital-doctor'), submitDischargeSummary);

router.patch('/status/duty-toggle', protect('hospital-doctor'), updateDutyStatus); // NO 403 ERROR NOW

module.exports = router;