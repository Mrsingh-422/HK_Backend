const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { fireStaffUploads } = require('../../../middleware/multer');
const { 
    getStationDashboard, getFreshCases, acceptCase, getAcceptedCases,getCaseHistory,
    getIncidentReport, getNearbyStations,
    addStaff, getStaffList, addVehicle, getFleetList ,getStaffRemovalReasons,
     updateStaff, deleteStaff, getStaffProfileDetails, addSupportingStation
} = require('../../../controllers/fireHQ/fireStation/stationManage');

// Base URL: /fireStation/management

// Dashboard
router.get('/dashboard', protect('fire-station'), getStationDashboard);

// Cases
router.get('/cases/fresh', protect('fire-station'), getFreshCases);
router.put('/cases/accept/:id', protect('fire-station'), acceptCase);
router.get('/cases/accepted', protect('fire-station'), getAcceptedCases);
router.get('/cases/history', protect('fire-station'), getCaseHistory);

router.get('/report/:id', protect('fire-station'), getIncidentReport); // Screen 66
// Nearby Stations
router.get('/nearby-stations', protect('fire-station'), getNearbyStations); // Screen 23
// Staff
router.post('/staff/add', protect('fire-station'), addStaff);
router.get('/staff/list', protect('fire-station'), getStaffList);

// Fleet
router.post('/fleet/add', protect('fire-station'), addVehicle);
router.get('/fleet/list', protect('fire-station'), getFleetList);

router.put('/staff/update/:id', protect('fire-station'), fireStaffUploads, updateStaff); 
router.delete('/staff/delete/:id', protect('fire-station'), deleteStaff);
router.get('/staff/profile/:id', protect('fire-station'), getStaffProfileDetails); // Screen 93
router.get('/staff/removal-reasons', protect('fire-station'), getStaffRemovalReasons);
router.post('/add-supporting-station', protect('fire-station'), addSupportingStation);
module.exports = router;