const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getStationDashboard, getFreshCases, acceptCase, 
    addStaff, getStaffList, addVehicle, getFleetList 
} = require('../../../controllers/fireHQ/fireStation/stationManage');

// Base URL: /fireStation/management

// Dashboard
router.get('/dashboard', protect('fire-station'), getStationDashboard);

// Cases
router.get('/cases/fresh', protect('fire-station'), getFreshCases);
router.put('/cases/accept/:id', protect('fire-station'), acceptCase);

// Staff
router.post('/staff/add', protect('fire-station'), addStaff);
router.get('/staff/list', protect('fire-station'), getStaffList);

// Fleet
router.post('/fleet/add', protect('fire-station'), addVehicle);
router.get('/fleet/list', protect('fire-station'), getFleetList);

module.exports = router;