const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { policeHQUploads } = require('../../../middleware/multer');
const {
    adminCreatePoliceHQ,
    getAllPoliceHQs,
    updatePoliceHQ,
    togglePoliceHQStatus,
    getAllPoliceStations,
    getAllPoliceStaff
} = require('../../../controllers/admin/others/PoliceHQ');
 
// Base URL: /api/admin/police
 
// --- POLICE HQ ROUTES ---
router.post('/create-policehq', protect('admin'), policeHQUploads, checkRoleAccess(9),adminCreatePoliceHQ);
router.get('/list-policehq', protect('admin'), checkRoleAccess(9),getAllPoliceHQs);
router.put('/update-policehq/:id', protect('admin'),checkRoleAccess(9), policeHQUploads, updatePoliceHQ);
router.delete('/status-policehq/:id', protect('admin'), checkRoleAccess(9), togglePoliceHQStatus);
 
 //  Police Station List (With HQ Name)
router.get('/station-list-only', protect('admin'), checkRoleAccess(9), getAllPoliceStations);
 
//  Police Staff List (With Station Name)
router.get('/staff-list-only', protect('admin'), checkRoleAccess(9), getAllPoliceStaff);
module.exports = router;
 
 