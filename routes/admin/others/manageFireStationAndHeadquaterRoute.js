const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { fireHQUploads, fireStationUploads } = require('../../../middleware/multer');
const {
    adminCreateFireHQ, getAllFireHQs, updateFireHQ, toggleHQStatus,
    adminCreateFireStation, getAllFireStations, updateFireStation, toggleStationStatus,
    getAllFireStaff
} = require('../../../controllers/admin/others/manageFireStationAndHeadquater');
 
// base URL  /api/admin/fire
 
// --- HQ ROUTES ---
router.post('/create-firehq', protect('admin'), fireHQUploads, adminCreateFireHQ);
router.get('/list-firehq', protect('admin'), getAllFireHQs);
router.put('/update-firehq/:id', protect('admin'), fireHQUploads, updateFireHQ);
router.delete('/status-firehq/:id', protect('admin'), toggleHQStatus); // Soft Delete
// GET List of all Fire Stations
router.get('/list-firestation-only', protect('admin'), getAllFireStations);
router.get('/staff-list-only', protect('admin'), getAllFireStaff);
 
 
module.exports = router;