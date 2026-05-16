const router = require('express').Router();
const { protect } = require('../../../middleware/authMiddleware');
const { ambulanceDocUploads } = require('../../../middleware/multer');
const { 
    getAmbulanceMasterData, getNearbyHospitals, getNearestAmbulances,getAmbulanceDetails,
    getAmbulanceCoupons, validateAmbulanceCoupon, calculateAmbulanceFare, 
    confirmAmbulanceBooking, getBookingStatus, addReview, updateReview,
    getUserNumbers, uploadIncidentPhoto, getLiveTracking,
    getMyAmbulanceBookings, cancelAmbulanceBooking
    
} = require('../../../controllers/user/Ambulance/AmbulanceBook');

// Base URL: /user/ambulance

// =============================================================================
// 1. DISCOVERY PHASE (Hospitals & Ambulances search)
// =============================================================================
router.get('/get-enums', getAmbulanceMasterData); // Dropdowns logic
router.post('/nearby-hospitals', getNearbyHospitals); // Figma Screen 42
router.post('/nearest-ambulances', getNearestAmbulances); // Figma Screen 43 (Displays Price 0 if Accidental)
router.get('/details/:id', getAmbulanceDetails);

// =============================================================================
// 2. CHECKOUT PHASE (Coupons & Fare calculation)
// =============================================================================
router.get('/coupons/:id', protect('user'), getAmbulanceCoupons);
router.post('/validate-coupon', protect('user'), validateAmbulanceCoupon);
router.post('/calculate-fare', protect('user'), calculateAmbulanceFare); // Combined pricing for all flows

// =============================================================================
// 3. BOOKING ACTIONS (Universal Confirm Booking)
// =============================================================================
// NOTE: Yeh ek hi API Medical, Accidental aur Referral teeno flows handle karegi.
// Referral Card upload ke liye 'referralCard' field use hogi.
router.post('/confirm-booking', protect('user'), ambulanceDocUploads, confirmAmbulanceBooking);

// Accidental cases only: Booking ke baad photo capture karne ke liye
router.post('/accidental/upload-photo/:bookingId', protect('user'), ambulanceDocUploads, uploadIncidentPhoto);

// =============================================================================
// 4. POST-BOOKING (Tracking & History)
// =============================================================================
router.get('/my-numbers', protect('user'), getUserNumbers); // Accidental: Choose your number
router.get('/track/:id', protect('user'), getBookingStatus); // General Tracking
router.get('/live-track/:id', protect('user'), getLiveTracking); // Detailed Driver Card (Amina, Van, etc.)

// =============================================================================
// 5. REVIEWS
// =============================================================================
router.post('/review/add', protect('user'), addReview);
router.put('/review/update/:id', protect('user'), updateReview);

////////
router.get('/my-bookings', protect('user'), getMyAmbulanceBookings);
router.patch('/cancel/:id', protect('user'), cancelAmbulanceBooking);

module.exports = router;