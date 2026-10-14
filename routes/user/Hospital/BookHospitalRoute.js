const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { insuranceUpload } = require('../../../middleware/multer');
const { 
    getHospitals, 
    getWards, getBedGrid, getDoctorsByHospitalId,getServicesByHospitalId,
    getHospitalCoupons, validateHospitalCoupon,

    getAvailableBedsForRange,
    getHospitalCheckoutSummary,cancelBedBooking, rescheduleBedBooking, getBedMonthlySchedule,
    finalHospitalBooking,verifyHospitalPayment,
    getMyHospitalBookings ,
    getBookingProfiles,
    getHospitalDetails,addReview, updateReview,
    rateHospitalAdmission,

    getHospitalDoctorOpdSlots,
    getHospitalOpdCheckoutSummary,
    bookHospitalOpdAppointment,getHospitalOpdLiveQueue,getHospitalBookingDetails,

    getActiveAdmissionHold,
    createAdmissionPaymentOrder,
    verifyAdmissionOnlinePayment,getPendingAdmissionDetails,
    cancelAdmissionBedHold
} = require('../../../controllers/user/Hospital/BookHospital');

// URL: /user/hospital

router.post('/list', getHospitals);
router.get('/details/:id', getHospitalDetails);

router.get('/wards', getWards);
router.get('/bed-grid/:wardId', getBedGrid);

router.get('/doctors/:hospitalId', getDoctorsByHospitalId); // To show list of doctors in hospital details page (Optional, can be integrated into /details response)
router.get('/services/:hospitalId', getServicesByHospitalId); // To show list of services in hospital details page (Optional, can be integrated into /details response)

router.get('/coupons/:hospitalId', getHospitalCoupons); // Get coupons applicable for this hospital
router.post('/validate-coupon', protect('user'), validateHospitalCoupon); // Validate coupon code and get discount details



router.post('/check-availability', getAvailableBedsForRange);
// Payment & Logic
router.post('/checkout-summary', protect('user'), getHospitalCheckoutSummary);
router.post('/book', protect('user'), insuranceUpload.single('insuranceDocument'), finalHospitalBooking);
router.post('/verify-payment', protect('user'), verifyHospitalPayment);

router.patch('/cancel/:id', protect('user'), cancelBedBooking);
router.post('/reschedule', protect('user'), rescheduleBedBooking);



router.get('/monthly-schedule', getBedMonthlySchedule);

// Management
router.get('/my-bookings', protect('user'), getMyHospitalBookings);
router.get('/booking-profiles', protect('user'), getBookingProfiles);

// Reviews
router.post('/add-review/:hospitalId', protect('user'), addReview);
router.put('/update-review/:reviewId', protect('user'), updateReview);
router.post('/rate', protect('user'), rateHospitalAdmission);

// 1. Get Doctor OPD Slots for selected date
router.get('/doctors/:doctorId/opd-slots', getHospitalDoctorOpdSlots);

// 2. OPD Checkout Summary
router.post('/opd/checkout-summary', protect('user'), getHospitalOpdCheckoutSummary);

// 3. Book OPD Appointment (Token Generation)
router.post('/opd/book', protect('user'), bookHospitalOpdAppointment);
router.get('/opd/live-queue/:appointmentId', protect('user'), getHospitalOpdLiveQueue);
router.get('/booking-details/:id', protect('user'), getHospitalBookingDetails);

// Patient App: View Admission Bill, Pay Online, or Decline
router.get('/admission/active-hold', protect('user'), getActiveAdmissionHold); // Mobile Sticky Banner Route    
router.get('/admission/pending-payment/:appointmentId', protect('user'), getPendingAdmissionDetails);
router.post('/admission/cancel-hold', protect('user'), cancelAdmissionBedHold);
router.post('/admission/create-payment-order', protect('user'), createAdmissionPaymentOrder);
router.post('/admission/verify-payment', protect('user'), verifyAdmissionOnlinePayment);
module.exports = router;