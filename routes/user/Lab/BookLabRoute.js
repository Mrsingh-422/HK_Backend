const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { doctorDocUploads } = require('../../../middleware/multer'); // Same keys for user uploads
const { 
    getLabs, 
    searchLabItems, 
    bookLabTest, 
    uploadPrescription,
    getMyLabBookings 
} = require('../../../controllers/user/Lab/BookLab');

// Base URL: /api/user/labs

// PUBLIC / SEMI-PUBLIC (POST used for complex filtering)
router.post('/list', getLabs);
router.post('/search-items', searchLabItems);

// PROTECTED (Requires User token)
router.post('/book', protect('user'), bookLabTest);
router.post('/upload-prescription', protect('user'), doctorDocUploads, uploadPrescription);
router.get('/my-bookings', protect('user'), getMyLabBookings);

module.exports = router;