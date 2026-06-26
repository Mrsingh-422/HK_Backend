const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { fireHQUploads, fireStationUploads } = require('../../../middleware/multer');
const {
    adminCreateFireHQ, getAllFireHQs, updateFireHQ, toggleHQStatus,
    adminCreateFireStation, getAllFireStations, updateFireStation, toggleStationStatus,
    getAllFireStaff
} = require('../../../controllers/admin/others/manageFireStationAndHeadquater');
 
// base URL  /api/admin/fire
 
// --- HQ ROUTES ---
router.post('/create-firehq', protect('admin'), checkRoleAccess(10),fireHQUploads, adminCreateFireHQ);
router.get('/list-firehq', protect('admin'), checkRoleAccess(10), getAllFireHQs);
router.put('/update-firehq/:id', protect('admin'), checkRoleAccess(10), fireHQUploads, updateFireHQ);
router.delete('/status-firehq/:id', protect('admin'), checkRoleAccess(10), toggleHQStatus); // Soft Delete
// GET List of all Fire Stations
router.get('/list-firestation-only', protect('admin'), checkRoleAccess(10), getAllFireStations);
router.get('/staff-list-only', protect('admin'), checkRoleAccess(10), getAllFireStaff);
 
 
module.exports = router;