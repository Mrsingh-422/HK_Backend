const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { 
    getHQDashboard, 
    createStation, 
    listMyStations, 
    getGlobalHistory,
    changePasswordHQ 
} = require('../../controllers/policeHQ/hqManagement');

// Base URL: /policeHQ/management

router.get('/dashboard', protect('police-hq'), getHQDashboard);
router.post('/create-station', protect('police-hq'), createStation);
router.get('/stations', protect('police-hq'), listMyStations);
router.get('/cases/history', protect('police-hq'), getGlobalHistory);
router.put('/change-password', protect('police-hq'), changePasswordHQ);

module.exports = router;