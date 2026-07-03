// routes/user/doctor/BookAppointment.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { requireConditionPlan } = require('../../../middleware/subscriptionCheckMiddleware');
const { userReportUploads } = require('../../../middleware/multer');

const { 
    getSpecializations, 
    searchDoctors, 
    getDoctorDetails, getDoctorVisitConfig, getAvailableCoupons, validateCoupon, getCheckoutSummary,
    bookAppointment, verifyDoctorPayment, // 👈 verifyDoctorPayment Imported
    verifyTrackingOTP,
    getUserAppointments, 
    userCancelAppointment, rescheduleAppointment,
    trackAppointment, getMyPrescriptions, getAvailableSlots, getTrackingStatus, getShareableTrackingLink,
    rateDoctorAppointment,getUserVideoConsults
} = require('../../../controllers/user/Doctor/BookAppointment');

// Base URL: /user/doctors

router.get('/specializations', getSpecializations);
router.post('/list', searchDoctors);
router.get('/details/:id', getDoctorDetails);
router.get('/visit-charges/:doctorId', getDoctorVisitConfig);
router.get('/coupons/:doctorId', protect('user'), getAvailableCoupons);
router.post('/validate-coupon', protect('user'), validateCoupon);
router.post('/checkout-summary', protect('user'), getCheckoutSummary);

// 1. Step 1: Create Order & Book
router.post('/book', protect('user'), userReportUploads, bookAppointment);

//////////////////////////////////////////////////////////////////////////////////////////////////////////
// 1a. Specialized Disease Care Booking (Dementia, Dialysis, Cancer) - Restricted to Subscribers
router.post('/book/specialist/:diseaseType', protect('user'), requireConditionPlan(), bookAppointment);
//////////////////////////////////////////////////////////////////////////////////////////////////////////

// 2. Step 2: Cryptographic Signature Verify & Confirm
router.post('/verify-payment', protect('user'), verifyDoctorPayment); // 👈 Added Route Path

router.post('/verify-otp', protect('user'), verifyTrackingOTP);
router.get('/my-appointments', protect('user'), getUserAppointments);
router.get('/track/:appointmentId', protect('user'), trackAppointment);
router.patch('/cancel/:id', protect('user'), userCancelAppointment);
router.post('/reschedule', protect('user'), rescheduleAppointment);
router.get('/prescriptions', protect('user'), getMyPrescriptions);
router.get('/slots/:doctorId', protect('user'), getAvailableSlots);
router.get('/tracking-status/:appointmentId', protect('user'), getTrackingStatus);
router.get('/shareable-link/:appointmentId', protect('user'), getShareableTrackingLink);

router.post('/rate', protect('user'), rateDoctorAppointment);
router.get('/video-consults', protect('user'), getUserVideoConsults);

module.exports = router;