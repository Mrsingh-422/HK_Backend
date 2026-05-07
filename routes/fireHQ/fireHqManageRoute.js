const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { fireStationUploads,fireStationUpdateUploads } = require('../../middleware/multer');
const { getDashboardStats,createFireCase,getIncidentDetails,
     createFireStation, getMyStations, getCaseHistory,
      getAdminContact,updateFireStation, deleteFireStation, updateJurisdiction,getJurisdictionData,
      requestBoundaryUpdate, getFullIncidentReport,getStationDetails,
getHQNotifications, deleteHQNotification, reassignFireCase, getDashboardChartData, markAllNotificationsRead,getBackupRequests, assignBackupStation,
      getNearbyStationsForIncident,assignResources } = require('../../controllers/fireHQ/fireHqManage');

// base url : /fireHQ/management

router.get('/dashboard', protect('fire-hq'), getDashboardStats);
router.post('/create-case', protect('fire-hq'), createFireCase);
router.get('/case/:id', protect('fire-hq'), getIncidentDetails);
router.post('/create-station', protect('fire-hq'), fireStationUploads, createFireStation);
router.get('/stations', protect('fire-hq'), getMyStations);
router.get('/station-profile/:id', protect('fire-hq'), getStationDetails);
router.get('/cases', protect('fire-hq'), getCaseHistory);
router.get('/help-contact', protect('fire-hq'), getAdminContact);
router.put('/update-station/:id', protect('fire-hq'), fireStationUpdateUploads, updateFireStation);
router.delete('/delete-station/:id', protect('fire-hq'), deleteFireStation);
router.put('/update-jurisdiction', protect('fire-hq'), updateJurisdiction);
router.get('/jurisdiction-data', protect('fire-hq'), getJurisdictionData);
router.get('/full-report/:id', protect('fire-hq'), getFullIncidentReport);
router.post('/request-boundary-update', protect('fire-hq'), requestBoundaryUpdate);

// Notifications
router.get('/notifications', protect('fire-hq'), getHQNotifications);
router.delete('/notifications/:id', protect('fire-hq'), deleteHQNotification);

// Operations
router.put('/reassign-case', protect('fire-hq'), reassignFireCase); // Screen 3
router.get('/analytics/chart', protect('fire-hq'), getDashboardChartData); // Screen 9

// Notifications
router.put('/notifications/mark-all-read', protect('fire-hq'), markAllNotificationsRead); // Screen 16

// Discovery
router.get('/discovery/nearby-stations', protect('fire-hq'), getNearbyStationsForIncident); // Screen 23

// Backup Requests
router.get('/backup-requests', protect('fire-hq'), getBackupRequests); // Screen 24
router.post('/assign-backup', protect('fire-hq'), assignBackupStation); // Screen 25
router.post('/assign-resources', protect('fire-hq'), assignResources); // Screen 26
module.exports = router;