const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getHospitals, 
    getWards, getBedGrid, getDoctorsByHospitalId,getServicesByHospitalId,
    getHospitalCoupons, validateHospitalCoupon,

    getAvailableBedsForRange,
    getHospitalCheckoutSummary, rescheduleBedBooking, getBedMonthlySchedule,
    finalHospitalBooking,
    getMyHospitalBookings ,
    getBookingProfiles,
    getHospitalDetails,addReview, updateReview
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
router.post('/checkout-summary', getHospitalCheckoutSummary);
router.post('/book', protect('user'), finalHospitalBooking);

router.post('/reschedule', protect('user'), rescheduleBedBooking);



router.get('/monthly-schedule', getBedMonthlySchedule);

// Management
router.get('/my-bookings', protect('user'), getMyHospitalBookings);
router.get('/booking-profiles', protect('user'), getBookingProfiles);

// Reviews
router.post('/add-review/:hospitalId', protect('user'), addReview);
router.put('/update-review/:reviewId', protect('user'), updateReview);
module.exports = router;