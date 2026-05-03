const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { fireCaseUploads } = require('../../../middleware/multer');
const {
    getStaffRoster,
    getPendingLeaves,
    updateLeaveStatus,
    updateCaseSeverity,
    submitFinalReport,
    getEquipment,
    addEquipment,
    updateEquipmentStatus,
    checkLeaveImpact,
    getEquipmentDetails,
    getFireTypes,
    applyLeave,
    toggleEmergencyMode,reassignStaffShift
} = require('../../../controllers/fireHQ/fireStation/opsController');

// Base URL: /fireStation/ops

// Staff Roster
router.get('/roster', protect('fire-station'), getStaffRoster);

// Leave Requests
router.get('/leaves/pending', protect('fire-station'), getPendingLeaves);
router.put('/leaves/:id/status',protect('fire-station'), updateLeaveStatus);
router.post('/leaves/post', protect('fire-station'), applyLeave);

// Case Management
router.put('/cases/:id/severity',protect('fire-station'), updateCaseSeverity);
router.post('/cases/:id/final-report',fireCaseUploads,protect('fire-station'), submitFinalReport);

// Equipment Management
router.get('/equipment', protect('fire-station'), getEquipment);
router.post('/equipment', protect('fire-station'), addEquipment);
router.put('/equipment/:id', protect('fire-station'), updateEquipmentStatus);
router.get('/equipment/:id', protect('fire-station'), getEquipmentDetails); // Screen 58 detailed specs
router.get('/leaves/impact', protect('fire-station'), checkLeaveImpact);
router.get('/fire-types', protect('fire-station'), getFireTypes);

// Emergency Mode
router.put('/emergency-mode', protect('fire-station'), toggleEmergencyMode);

router.put('/staff/reassign-shift', protect('fire-station'), reassignStaffShift); // Screen 50


module.exports = router;