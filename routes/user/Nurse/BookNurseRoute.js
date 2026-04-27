const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getNurses, getNurseDetails,  searchNurses, bookNurse, getMyNurseAppointments 
} = require('../../../controllers/user/Nurse/BookNurse');

// Base URL: /user/nurse

// Search/Filter list (POST is preferred for complex filters)
router.post('/list', getNurses); 
router.get('/details/:id', getNurseDetails);

// Search (If you want a dedicated search endpoint)
router.post('/search', searchNurses);

// Services

// Bookings
router.post('/book', protect('user'), bookNurse);
router.get('/my-appointments', protect('user'), getMyNurseAppointments);

module.exports = router;