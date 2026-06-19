// routes/ambulance/BookingAmb.js
const router = require('express').Router();
const { protect } = require('../../middleware/authMiddleware');
const { ambulanceDocUploads } = require('../../middleware/multer'); // Reusing existing
const controller = require('../../controllers/ambulance/BookingAmb'); // New controller for ambulance booking management

// Base URL: /ambulance/booking

router.get('/active-trip', protect(['ambulance', 'hospital-ambulance']), controller.getMyActiveTrip);
router.get('/requests', protect(['ambulance', 'hospital-ambulance']), controller.getIncomingRequests);

router.patch('/accept/:id', protect(['ambulance', 'hospital-ambulance']), controller.acceptBooking);
router.patch('/reject/:id', protect(['ambulance', 'hospital-ambulance']), controller.rejectBooking); 

router.patch('/update-trip/:id', protect(['ambulance', 'hospital-ambulance']), controller.updateTripStatus);
router.post('/incident-photo/:id', protect(['ambulance', 'hospital-ambulance']), ambulanceDocUploads, controller.uploadIncidentPhoto);

router.patch('/finalize-handoff/:id', protect(['ambulance', 'hospital-ambulance']), controller.finalizeTripHandoff);
router.patch('/verify-otp/:id', protect(['ambulance', 'hospital-ambulance']), controller.verifyPickupOtp);



// FIX: Replaced 'patch' with 'router.patch' to prevent router crash
router.patch('/re-route/:id', protect(['ambulance', 'hospital-ambulance']), controller.reRouteAmbulance); 
router.get('/dashboard-stats', protect(['ambulance', 'hospital-ambulance']), controller.getDriverDashboardStats); 

router.get('/history', protect(['ambulance', 'hospital-ambulance']), controller.getDriverTripHistory); 


module.exports = router;