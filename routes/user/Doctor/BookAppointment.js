const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { userReportUploads } = require('../../../middleware/multer');

const { 
    getSpecializations, 
    searchDoctors, 
    getDoctorDetails,getDoctorVisitConfig, getAvailableCoupons,validateCoupon, getCheckoutSummary,
    bookAppointment, verifyTrackingOTP,
    getUserAppointments, 
    userCancelAppointment,
    trackAppointment , getMyPrescriptions, getAvailableSlots,getTrackingStatus,getShareableTrackingLink
} = require('../../../controllers/user/Doctor/BookAppointment');

// Base URL: /user/doctors
// // PUBLIC
router.get('/specializations', getSpecializations);
router.post('/list', searchDoctors);
router.get('/details/:id', getDoctorDetails);
router.get('/visit-charges/:doctorId', getDoctorVisitConfig);
router.get('/coupons/:doctorId', protect('user'), getAvailableCoupons);
router.post('/validate-coupon', protect('user'), validateCoupon);
router.post('/checkout-summary', protect('user'), getCheckoutSummary);

// PROTECTED (Requires User token)
router.post('/book', protect('user'),userReportUploads, bookAppointment);
router.post('/verify-otp', protect('user'), verifyTrackingOTP);
router.get('/my-appointments', protect('user'), getUserAppointments);
router.get('/track/:appointmentId', protect('user'), trackAppointment);
router.patch('/cancel/:id', protect('user'), userCancelAppointment);
router.get('/prescriptions', protect('user'), getMyPrescriptions);
router.get('/slots/:doctorId', protect('user'), getAvailableSlots);

router.get('/tracking-status/:appointmentId', protect('user'), getTrackingStatus);
router.get('/shareable-link/:appointmentId', protect('user'), getShareableTrackingLink);

module.exports = router;