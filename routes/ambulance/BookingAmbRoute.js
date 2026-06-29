// routes/ambulance/BookingAmb.js
const router = require('express').Router();
const { protect } = require('../../middleware/authMiddleware');
const { ambulanceDocUploads } = require('../../middleware/multer');
const controller = require('../../controllers/ambulance/BookingAmb');

// Base URL: /ambulance/booking

// --- ACTIVE TRIP & REQUESTS ---
router.get('/active-trip', protect(['ambulance', 'hospital-ambulance']), controller.getMyActiveTrip);
router.get('/requests', protect(['ambulance', 'hospital-ambulance']), controller.getIncomingRequests);

// --- RIDE CONFIRMATION / REJECTION ---
router.patch('/accept/:id', protect(['ambulance', 'hospital-ambulance']), controller.acceptBooking);
router.patch('/reject/:id', protect(['ambulance', 'hospital-ambulance']), controller.rejectBooking); 

// --- STAGE 1: PICKUP ---
router.patch('/verify-otp/:id', protect(['ambulance', 'hospital-ambulance']), controller.verifyPickupOtp); // Screen 36
router.post('/incident-photo/:id', protect(['ambulance', 'hospital-ambulance']), ambulanceDocUploads, controller.uploadIncidentPhoto);

// --- STAGE 2: TRANSIT & RE-ROUTING ---
router.patch('/update-trip/:id', protect(['ambulance', 'hospital-ambulance']), controller.updateTripStatus);
router.patch('/re-route/:id', protect(['ambulance', 'hospital-ambulance']), controller.reRouteAmbulance); 

// --- STAGE 3: DROPOFF & HOSPITAL OTP (Figma Screen 12 & 14) ---
router.patch('/arrived-dropoff/:id', protect(['ambulance', 'hospital-ambulance']), controller.arrivedAtDropOff); // Generates Hospital OTP
router.patch('/verify-dropoff-otp/:id', protect(['ambulance', 'hospital-ambulance']), controller.verifyDropOffOtp); // Verifies Hospital OTP

// --- STAGE 4: FINALIZE HANDOFF (Screen 15) ---
router.patch('/finalize-handoff/:id', protect(['ambulance', 'hospital-ambulance']), controller.finalizeTripHandoff);

// --- MANAGEMENT & SOS (Screen 18) ---
router.post('/sos/:id', protect(['ambulance', 'hospital-ambulance']), controller.triggerAmbulanceSos); // Emergency SOS Trigger
router.get('/dashboard-stats', protect(['ambulance', 'hospital-ambulance']), controller.getDriverDashboardStats); 
router.get('/history', protect(['ambulance', 'hospital-ambulance']), controller.getDriverTripHistory); 

// --- CHANGE PASSWORD ---
router.patch('/change-password', protect(['ambulance', 'hospital-ambulance']), controller.changeDriverPassword);

// --- NOTIFICATIONS ---
router.get('/notifications', protect(['ambulance', 'hospital-ambulance']), controller.getDriverNotifications);
router.patch('/notifications/mark-read', protect(['ambulance', 'hospital-ambulance']), controller.markAllNotificationsAsRead);

module.exports = router;