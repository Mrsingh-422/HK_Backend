const router = require('express').Router();

const { protect } = require('../../../middleware/authMiddleware');
const { 
    addHealthMetric,
    getLatestMetrics,
    getHealthStats,
    getHealthHistory,
    deleteHealthRecord
} = require('../../../controllers/user/Doctor/HealthData');

// Base route: /api/user/health-records

router.post('/add-metric', protect('user'), addHealthMetric);
router.get('/latest', protect('user'), getLatestMetrics); // Dashboard ke liye
router.get('/stats', protect('user'), getHealthStats);   // Graphs ke liye
router.get('/history', protect('user'), getHealthHistory); // List view ke liye
router.delete('/delete/:id', protect('user'), deleteHealthRecord);

module.exports = router;