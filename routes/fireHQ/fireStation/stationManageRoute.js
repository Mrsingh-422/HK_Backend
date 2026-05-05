const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { fireStaffUploads ,fireEvidenceUploads } = require('../../../middleware/multer');
const { 
    getStationDashboard, getFreshCases,getFreshCaseDetails, acceptCase, getAcceptedCases,getCaseHistory,
    getIncidentReport, getNearbyStations,updateIncidentStatusDetailed,
    addStaff, getStaffList, addVehicle, getFleetList ,getStaffRemovalReasons,
     updateStaff, deleteStaff, getStaffProfileDetails, addSupportingStation,assignResourcesToCase, 
         addVehicleActivityLog,updateVehicleStatus,toggleCaseHoldStatus,
          getJurisdictionDetails, getStationNotifications, updatePreferences, getAppLegalInfo
} = require('../../../controllers/fireHQ/fireStation/stationManage');

// Base URL: /fireStation/management

// Dashboard
router.get('/dashboard', protect('fire-station'), getStationDashboard);

// Cases
router.get('/cases/fresh', protect('fire-station'), getFreshCases);
router.get('/cases/fresh/:id', protect('fire-station'), getFreshCaseDetails); // Screen 65
router.put('/cases/accept/:id', protect('fire-station'), acceptCase);
router.get('/cases/accepted', protect('fire-station'), getAcceptedCases);
router.get('/cases/history', protect('fire-station'), getCaseHistory);

router.get('/report/:id', protect('fire-station'), getIncidentReport); // Screen 66
// Nearby Stations
router.get('/nearby-stations', protect('fire-station'), getNearbyStations); // Screen 23
router.put('/cases/update-status/:id', protect('fire-station'),fireEvidenceUploads, updateIncidentStatusDetailed); // Screen 101
// Staff
router.post('/staff/add', protect('fire-station'), addStaff);
router.get('/staff/list', protect('fire-station'), getStaffList);
router.get('/staff/profile/:id', protect('fire-station'), getStaffProfileDetails); // Screen 93
router.get('/staff/removal-reasons', protect('fire-station'), getStaffRemovalReasons);
router.put('/staff/update/:id', protect('fire-station'), fireStaffUploads, updateStaff);  
router.delete('/staff/delete/:id', protect('fire-station'), deleteStaff);

// Fleet
router.post('/fleet/add', protect('fire-station'), addVehicle);
router.get('/fleet/list', protect('fire-station'), getFleetList);




router.post('/add-supporting-station', protect('fire-station'), addSupportingStation);
router.put('/cases/assign-resources', protect('fire-station'), assignResourcesToCase); // Screen 100
router.post('/fleet/log-activity', protect('fire-station'), addVehicleActivityLog); // Screen 7

router.put('/fleet/update-status', protect('fire-station'), updateVehicleStatus); // Screen 8
router.put('/cases/hold-toggle/:id', protect('fire-station'), toggleCaseHoldStatus); // Screen 102

router.get('/jurisdiction', protect('fire-station'), getJurisdictionDetails);



// Notifications
router.get('/notifications', protect('fire-station'), getStationNotifications);
router.put('/notifications/mark-read', protect('fire-station'), async (req, res) => {
    await FireNotification.updateMany({ stationId: req.user.id }, { isRead: true });
    res.json({ success: true, message: "Marked all as read" });
});

// Preferences & Legal (Screen 18/19)
router.put('/preferences', protect('fire-station'), updatePreferences);
router.get('/legal-info', protect('fire-station'), getAppLegalInfo);



module.exports = router;