const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getHospitals, 
    getBedAvailability, getBedGrid,
    getHospitalCheckoutSummary, 
    finalHospitalBooking,
    getMyHospitalBookings 
} = require('../../../controllers/user/Hospital/BookHospital');

// URL: /user/hospital

router.get('/list', getHospitals);
router.get('/beds', getBedAvailability);

router.get('/bed-grid', getBedGrid)

// Payment & Logic
router.post('/checkout-summary', protect('user'), getHospitalCheckoutSummary);
router.post('/book', protect('user'), finalHospitalBooking);

// Management
router.get('/my-bookings', protect('user'), getMyHospitalBookings);

module.exports = router;