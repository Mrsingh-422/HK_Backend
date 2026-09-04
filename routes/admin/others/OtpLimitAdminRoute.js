// routes/admin/others/OtpLimitAdminRoute.js
const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const {
    getBlockedOtpList,
    resetIdentifierLimit,
    getOtpLimitConfigs,
    updateOtpLimitConfig
} = require('../../../controllers/admin/others/OtpLimitAdmin');

// Base URL: /api/admin/otp-limits

// 1. Live Blocklist & Unblock
router.get('/blocked-list', protect('admin'), checkRoleAccess(39), getBlockedOtpList);
router.post('/reset-identifier', protect('admin'), checkRoleAccess(39), resetIdentifierLimit);

// 2. Configurations & Traffic Stats
router.get('/', protect('admin'), checkRoleAccess(39), getOtpLimitConfigs);
router.post('/update', protect('admin'), checkRoleAccess(39), updateOtpLimitConfig);

module.exports = router;