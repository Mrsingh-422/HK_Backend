const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { addReview, getVendorReviews } = require('../../../controllers/user/others/Review');

// Base URL: /user/review

// Add a review (Protected)
// Body: { targetId, targetType, orderId, rating, comment }
// targetId: Doctor/Lab/Pharmacy/Nurse/Hospital/Ambulance/Driver ID
// targetType: 'Doctor', 'Lab', 'Pharmacy', 'Nurse', 'Hospital', 'Ambulance', 'Driver'
router.post('/add', protect('user'), addReview);

// Public list for any vendor profile
// targetType: 'Doctor', 'Lab', 'Pharmacy', 'Nurse', 'Hospital', 'Ambulance', 'Driver'
//targetId: Doctor/Lab/Pharmacy/Nurse/Hospital/Ambulance/Driver ID
router.get('/list/:targetType/:targetId', getVendorReviews);

module.exports = router;