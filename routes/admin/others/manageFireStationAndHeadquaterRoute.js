const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { fireHQUploads, fireStationUploads } = require('../../../middleware/multer');
const {
    adminCreateFireHQ, getAllFireHQs, updateFireHQ, toggleHQStatus,
    adminCreateFireStation, getAllFireStations, updateFireStation, toggleStationStatus
} = require('../../../controllers/admin/others/manageFireStationAndHeadquater');
 
// base URL  /api/admin/fire
 
// --- HQ ROUTES ---
router.post('/create-firehq', protect('admin'), fireHQUploads, adminCreateFireHQ);
router.get('/list-firehq', protect('admin'), getAllFireHQs);
router.put('/update-firehq/:id', protect('admin'), fireHQUploads, updateFireHQ);
router.delete('/status-firehq/:id', protect('admin'), toggleHQStatus); // Soft Delete
 
module.exports = router;