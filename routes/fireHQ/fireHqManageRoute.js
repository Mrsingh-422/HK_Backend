const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { fireStationUploads } = require('../../middleware/multer');
const { getDashboardStats,createFireCase,getIncidentDetails,
     createFireStation, getMyStations, getCaseHistory,
      getAdminContact,updateFireStation, deleteFireStation, getJurisdictionData, getFullIncidentReport } = require('../../controllers/fireHQ/fireHqManage');

// base url : /fireHQ/management

router.get('/dashboard', protect('fire-hq'), getDashboardStats);
router.post('/create-case', protect('fire-hq'), createFireCase);
router.get('/case/:id', protect('fire-hq'), getIncidentDetails);
router.post('/create-station', protect('fire-hq'), createFireStation);
router.get('/stations', protect('fire-hq'), getMyStations);
router.get('/cases', protect('fire-hq'), getCaseHistory);
router.get('/help-contact', protect('fire-hq'), getAdminContact);
router.put('/update-station/:id', protect('fire-hq'), fireStationUploads, updateFireStation);
router.delete('/delete-station/:id', protect('fire-hq'), deleteFireStation);
router.get('/jurisdiction-data', protect('fire-hq'), getJurisdictionData);
router.get('/full-report/:id', protect('fire-hq'), getFullIncidentReport);
module.exports = router;