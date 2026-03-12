const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');

const {
    addReview,
    getDoctorReviews,
    getMyReviews,
    deleteReview
} = require('../../../controllers/user/Doctor/ReviewDoctor');

// Base path: /user/review

router.post('/add-review', protect('user'), addReview);
router.get('/doctor/:doctorId', getDoctorReviews); // Public: Doctors ki profile par dikhane ke liye
router.get('/my-reviews', protect('user'), getMyReviews); // User ka apna history
router.delete('/delete/:id', protect('user'), deleteReview);

module.exports = router;