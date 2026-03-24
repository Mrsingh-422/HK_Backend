const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { prescriptionUploads } = require('../../../middleware/multer'); // Ensure this handles 'prescriptionImages' key
const { 
    getLabs, getLabDetails, getLabSlots,
    bookLabTest, uploadPrescriptionFlow,
    getMyBookings, getBookingDetails 
} = require('../../../controllers/user/Lab/BookLab');

// Discovery
router.get('/list', getLabs);
router.get('/details/:id', getLabDetails);
router.get('/slots', getLabSlots);

// Booking (Protected)
router.post('/book', protect('user'), bookLabTest);
router.post('/upload-prescription', protect('user'), prescriptionUploads.array('prescriptionImages', 5), uploadPrescriptionFlow);

// Tracking & History
router.get('/my-bookings', protect('user'), getMyBookings);
router.get('/details/:id/track', protect('user'), getBookingDetails);

module.exports = router;