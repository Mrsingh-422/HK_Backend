const router = require('express').Router();
const { protect } = require('../../middleware/authMiddleware');
const { ambulanceDocUploads } = require('../../middleware/multer'); // Reusing existing
const controller = require('../../controllers/ambulance/BookingAmb'); // New controller for ambulance booking management

// Base URL: /ambulance/booking

router.get('/requests', protect(['ambulance', 'hospital-ambulance']), controller.getIncomingRequests);
router.patch('/accept/:bookingId', protect(['ambulance', 'hospital-ambulance']), controller.acceptBooking);
router.patch('/update-trip/:id', protect(['ambulance', 'hospital-ambulance']), controller.updateTripStatus);
router.post('/incident-photo/:id', protect(['ambulance', 'hospital-ambulance']), ambulanceDocUploads, controller.uploadIncidentPhoto);

router.patch('/finalize-handoff/:id', protect(['ambulance', 'hospital-ambulance']), controller.finalizeTripHandoff);



module.exports = router;