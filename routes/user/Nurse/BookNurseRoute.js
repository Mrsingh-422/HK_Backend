const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { prescriptionUploads } = require('../../../middleware/multer');
const { 
    getNurses, getNurseDetails,  searchNurses,getNurseAvailability, checkoutNurseBooking, placeNurseBooking, getMyNurseBookings, rateNurseService,
    getAppointmentStatus, 
    uploadBookingPrescription 
} = require('../../../controllers/user/Nurse/BookNurse');

// Base URL: /user/nurse

// Search/Filter list (POST is preferred for complex filters)
router.post('/list', getNurses); 
router.get('/details/:id', getNurseDetails);

// 2. Booking Flow
router.post('/checkout', protect('user'), checkoutNurseBooking);
router.post('/book', protect('user'), placeNurseBooking);
router.get('/track/:id', protect('user'), getAppointmentStatus); // Figma Tracking Screen

// 3. Add-ons
router.patch('/add-prescription/:id', protect('user'), prescriptionUploads.single('prescription'), uploadBookingPrescription);

// 4. Availability
router.get('/availability/:nurseId', getNurseAvailability); // Screen 7
router.get('/my-appointments', protect('user'), getMyNurseBookings); // Screen 11
router.post('/rate', protect('user'), rateNurseService); // Screen 12




// Search (If you want a dedicated search endpoint)
router.post('/search', searchNurses);

module.exports = router;