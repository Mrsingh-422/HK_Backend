const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getHospitals, 
    getWards, getBedGrid,
    getHospitalCheckoutSummary, 
    finalHospitalBooking,
    getMyHospitalBookings ,
    getBookingProfiles,
    getHospitalDetails
} = require('../../../controllers/user/Hospital/BookHospital');

// URL: /user/hospital

router.post('/list', getHospitals);
router.get('/details/:id', getHospitalDetails);

router.get('/wards', getWards);
router.get('/bed-grid/:wardId', getBedGrid);

// Payment & Logic
router.post('/checkout-summary', protect('user'), getHospitalCheckoutSummary);
router.post('/book', protect('user'), finalHospitalBooking);

// Management
router.get('/my-bookings', protect('user'), getMyHospitalBookings);
router.get('/booking-profiles', protect('user'), getBookingProfiles);
module.exports = router;