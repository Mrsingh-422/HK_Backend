const router = require('express').Router();
const { protect } = require('../../../middleware/authMiddleware');
const { ambulanceDocUploads } = require('../../../middleware/multer');
const { getAmbulanceMasterData,getNearbyHospitals,getNearestAmbulances,createAmbulanceBooking,getBookingStatus,
    getAmbulanceCoupons,validateAmbulanceCoupon,confirmAmbulanceBooking,addReview,updateReview,
    getUserNumbers,createAccidentalBooking,uploadIncidentPhoto,getLiveTracking
} = require('../../../controllers/user/Ambulance/AmbulanceBook');

// Base URL: /user/ambulance

// 1. Get Enums for dropdowns (Screen 32, 41)
router.get('/get-enums', getAmbulanceMasterData);

// 2. Search Hospitals (Screen 42) - POST for location
router.post('/nearby-hospitals', getNearbyHospitals);

// 3. Search Ambulances (Screen 43) - POST for location & filters
router.post('/nearest-ambulances', getNearestAmbulances);

// 4. Booking Management
router.post('/book', protect('user'), createAmbulanceBooking);
router.get('/track/:id', protect('user'), getBookingStatus);

router.get('/coupons', protect('user'), getAmbulanceCoupons);
router.post('/validate-coupon', protect('user'), validateAmbulanceCoupon);
router.post('/confirm-booking', protect('user'), confirmAmbulanceBooking);

// --- REVIEWS ---
router.post('/review/add', protect('user'), addReview);
router.put('/review/update/:id', protect('user'), updateReview);

//--------------------------- Accidental Ambulance Bookings ---------------------------//
router.get('/my-numbers', protect('user'), getUserNumbers); // Screen: Choose your number
router.post('/accidental/book', protect('user'), createAccidentalBooking); // Screen: Accidental Emergency
router.post('/accidental/upload-photo/:bookingId', protect('user'), ambulanceDocUploads, uploadIncidentPhoto); // Screen: Capture Incident Photo
router.get('/accidental/track/:id', protect('user'), getLiveTracking); // Screen: Arriving in 5 mins




module.exports = router;