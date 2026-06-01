const router = require('express').Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    addHealthMetric,
    getHealthStats,
    getDashboardSummary,
    getHealthHistory,
    addMeal,
    getCalorieBreakdown
} = require('../../../controllers/user/Doctor/HealthData');

// Base route: /user/health-records

router.post('/add-metric', protect('user'), addHealthMetric); 
router.get('/summary', protect('user'), getDashboardSummary); 
router.get('/stats', protect('user'), getHealthStats);        
router.get('/history', protect('user'), getHealthHistory);    
router.post('/add-meal', protect('user'), addMeal); 
router.get('/calorie-breakdown', protect('user'), getCalorieBreakdown); 

module.exports = router;