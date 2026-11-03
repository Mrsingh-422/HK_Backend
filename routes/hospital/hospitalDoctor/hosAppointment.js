const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const { 
    rejectHospitalBooking,
    recordOpdPatientVitals,
    getHospitalPendingAdmissionHolds,
    collectAdmissionCounterPayment,
    switchAdmissionHeldBedAtCounter
} = require('../../../controllers/hospital/hospitalDoctor/hosAppoinment');

// Base URL: /hospital/doctor/appointments

// 1. Booking Rejection by Hospital Desk
router.patch('/reject/:id', protect('hospital'), rejectHospitalBooking);

// 2. OPD Vitals Recording (Triage / Pre-Consultation)
router.patch('/opd-vitals/:id', protect(['hospital', 'hospital-doctor']), recordOpdPatientVitals);

// 3. Admission Desk: Pending 30-Min Holds, Deposit Collection & Bed Switch
router.get('/admissions/pending-holds', protect('hospital'), getHospitalPendingAdmissionHolds);
router.patch('/admission/collect-payment/:id', protect('hospital'), collectAdmissionCounterPayment);
router.patch('/admission/switch-bed/:id', protect('hospital'), switchAdmissionHeldBedAtCounter);

module.exports = router;