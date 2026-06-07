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

// router.get('/seed-pickup-coordinates', async (req, res) => {
//     try {
//         const Booking = require('../../../models/AmbulanceBooking'); // Import booking model natively
        
//         // Find all accidental & medical bookings from database
//         const bookings = await Booking.find({
//             serviceType: { $in: ['Accident emergency', 'Medical Ambulance'] }
//         });

//         let updatedCount = 0;

//         // Standard Mohali location addresses pool for matching
//         const mohaliAddresses = [
//             "Sector 62, Mohali, Punjab",
//             "Phase 3B2, Mohali, Punjab",
//             "Phase 7, Mohali, Punjab",
//             "Sector 70, Mohali, Punjab",
//             "Phase 11, Mohali, Punjab",
//             "Tdi Business Center, Mohali, Punjab",
//             "Sector 74, Sahibzada Ajit Singh Nagar, Punjab"
//         ];

//         for (const booking of bookings) {
//             // Generates completely random coordinates strictly inside Mohali geographic boundaries
//             const lat = parseFloat((30.6800 + Math.random() * (30.7500 - 30.6800)).toFixed(6));
//             const lng = parseFloat((76.6800 + Math.random() * (76.7500 - 76.6800)).toFixed(6));
            
//             const randomAddress = mohaliAddresses[Math.floor(Math.random() * mohaliAddresses.length)];

//             booking.pickupLocation = {
//                 address: booking.pickupLocation?.address || randomAddress,
//                 lat: lat,
//                 lng: lng
//             };

//             await booking.save();
//             updatedCount++;
//         }

//         res.json({
//             success: true,
//             message: `Pickup locations successfully seeded with random Mohali/Chandigarh coordinates for ${updatedCount} bookings.`,
//             updatedCount
//         });

//     } catch (error) {
//         console.error("Seeding Error:", error);
//         res.status(500).json({ success: false, message: error.message });
//     }
// });

module.exports = router;