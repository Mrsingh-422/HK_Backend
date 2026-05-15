const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');

const { 
    getDoctorBookings,
    getTodayBookings,
    confirmAppointment,
    doctorCancelAppointment,
    startVisit,
    completeWithPrescription, 
    getDoctorStats,
    getMyConsultationFees, 
    updateConsultationFees, rescheduleAppointment,getAllPrescriptions,
    getPrescriptionDetails, updatePrescription, resendPrescription, createPrescription,
    getPatientHistory, getPatientHistoryDetails
} = require('../../controllers/doctor/Appointment');

// Base URL: /doctor/appointments

// 1. Dashboard Stats (Figma: Total Revenue, Completed count)
router.get('/stats', protect('doctor'), getDoctorStats);

// 2. Main Appointment List (Figma: Patient Bookings)
router.get('/patient-bookings', protect('doctor'), getDoctorBookings);

// 3. Today's List (Figma: Today's Schedule)
router.get('/today-appointments', protect('doctor'), getTodayBookings);

// 4. Actions
router.patch('/confirm/:id', protect('doctor'), confirmAppointment);
router.patch('/cancel/:id', protect('doctor'), doctorCancelAppointment);
router.patch('/start-visit/:id', protect('doctor'), startVisit);
router.post('/complete/:id', protect('doctor'), completeWithPrescription);

// 5. Fees Management
router.get('/profile/fees', protect('doctor'), getMyConsultationFees);
router.put('/profile/update-fees', protect('doctor'), updateConsultationFees);

router.post('/reschedule/:id', protect('doctor'), rescheduleAppointment);

// Create new prescription
router.post('/create-prescription', protect('doctor'), createPrescription);
router.get('/all-prescription', protect('doctor'), getAllPrescriptions);
router.get('/prescription/:id', protect('doctor'), getPrescriptionDetails);
 
// Figma Actions: Edit and Resend
router.put('/prescription/edit/:id', protect('doctor'), updatePrescription);
router.post('/prescription/resend/:id', protect('doctor'), resendPrescription);

router.get('/patient-history', protect('doctor'), getPatientHistory);
router.get('/patient-history/:id', protect('doctor'), getPatientHistoryDetails);

module.exports = router;