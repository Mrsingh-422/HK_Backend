const router = require('express').Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    addHealthMetric,
    getHealthStats,
    getDashboardSummary,
    getHealthHistory,addMeal,
        getCalorieBreakdown
} = require('../../../controllers/user/Doctor/HealthData');

// Base route: /user/health-records

router.post('/add-metric', protect('user'), addHealthMetric); // Add Screen
router.get('/summary', protect('user'), getDashboardSummary); // Dashboard Home Card
router.get('/stats', protect('user'), getHealthStats);        // Details Screen (Graph + Min/Max/Avg)
router.get('/history', protect('user'), getHealthHistory);    // History List

// --- Meal Logging ---
router.post('/add-meal', protect('user'), addMeal); // Log a meal with food items and calories
router.get('/calorie-breakdown', protect('user'), getCalorieBreakdown); // Get calorie breakdown by meal type for the current day

module.exports = router;