const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    adminGetNurseBookings,
    adminGetApprovedNurses,
    toggleActiveInactiveNurse,
     adminGetNurseServices,
    adminGetNursePackages,
    adminUpdateNurseServiceStatus,
    adminUpdateNursePackageStatus
} = require('../../../controllers/admin/Nurse/NurseAdmin');

// Base URL: /admin/nurse

router.get('/approved-list', protect('admin'), checkRoleAccess(5), adminGetApprovedNurses);
router.get('/bookings', protect('admin'), checkRoleAccess(36), adminGetNurseBookings);
router.patch('/status/active-inactive/:nurseId', protect('admin'), checkRoleAccess(36), toggleActiveInactiveNurse);

// --- Nurse Services & Packages Management ---
router.get('/services', protect('admin'), checkRoleAccess(36), adminGetNurseServices);
router.get('/packages', protect('admin'), checkRoleAccess(36), adminGetNursePackages);
router.patch('/services/status/:id', protect('admin'), checkRoleAccess(36), adminUpdateNurseServiceStatus);
router.patch('/packages/status/:id', protect('admin'), checkRoleAccess(36), adminUpdateNursePackageStatus);
 

module.exports = router;