const express = require('express');
const router = express.Router();
const {
    getStaffRoster,
    getPendingLeaves,
    updateLeaveStatus,
    updateCaseSeverity,
    submitFinalReport,
    getEquipment,
    addEquipment,
    updateEquipmentStatus
} = require('../../../controllers/fireHQ/fireStation/opsController');

// Base URL: /fireStation/ops

// Staff Roster
router.get('/roster', getStaffRoster);

// Leave Requests
router.get('/leaves/pending', getPendingLeaves);
router.put('/leaves/:id/status', updateLeaveStatus);

// Case Management
router.put('/cases/:id/severity', updateCaseSeverity);
router.post('/cases/:id/final-report', submitFinalReport);

// Equipment Management
router.get('/equipment', getEquipment);
router.post('/equipment', addEquipment);
router.put('/equipment/:id', updateEquipmentStatus);

module.exports = router;