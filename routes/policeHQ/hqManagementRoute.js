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

router.get('/dashboard', protect('police-HQ'), getHQDashboard);
router.post('/create-station', protect('police-HQ'), createStation);
router.get('/stations', protect('police-HQ'), listMyStations);
router.get('/cases/history', protect('police-HQ'), getGlobalHistory);
router.put('/change-password', protect('police-HQ'), changePasswordHQ);

module.exports = router;