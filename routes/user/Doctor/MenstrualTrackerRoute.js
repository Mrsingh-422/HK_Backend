const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { updatePeriodData, getPeriodInsights } = require('../../../controllers/user/Doctor/MenstrualController');

// Base URL: /user/doctor/menstrual

// Menstrual Tracking Routes
router.post('/update', protect('user'), updatePeriodData);
router.get('/insights', protect('user'), getPeriodInsights);

module.exports = router;