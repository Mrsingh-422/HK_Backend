const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { setVendorKMLimit, getVendorKMLimits } = require('../../../controllers/admin/others/VendorKMLimit');

// Base URL: /admin/vendor-km-limit

router.post('/set-km-limit', protect('admin'), checkRoleAccess(54),setVendorKMLimit);
router.get('/get-km-limits', protect('admin'), checkRoleAccess(54), getVendorKMLimits);

module.exports = router;