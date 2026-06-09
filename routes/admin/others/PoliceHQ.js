const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
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
router.post('/create-policehq', protect('admin'), policeHQUploads, adminCreatePoliceHQ);
router.get('/list-policehq', protect('admin'), getAllPoliceHQs);
router.put('/update-policehq/:id', protect('admin'), policeHQUploads, updatePoliceHQ);
router.delete('/status-policehq/:id', protect('admin'), togglePoliceHQStatus);
 
 //  Police Station List (With HQ Name)
router.get('/station-list-only', protect('admin'), getAllPoliceStations);
 
//  Police Staff List (With Station Name)
router.get('/staff-list-only', protect('admin'), getAllPoliceStaff);
module.exports = router;
 
 