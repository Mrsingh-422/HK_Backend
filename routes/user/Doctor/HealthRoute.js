const router = require('express').Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    addHealthMetric,
    getHealthStats,
    getDashboardSummary,
    getHealthHistory
} = require('../../../controllers/user/Doctor/HealthData');

// Base route: /user/health-records

router.post('/add-metric', protect('user'), addHealthMetric); // Add Screen
router.get('/summary', protect('user'), getDashboardSummary); // Dashboard Home Card
router.get('/stats', protect('user'), getHealthStats);        // Details Screen (Graph + Min/Max/Avg)
router.get('/history', protect('user'), getHealthHistory);    // History List

module.exports = router;