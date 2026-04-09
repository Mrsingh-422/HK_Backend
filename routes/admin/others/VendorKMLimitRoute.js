const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { setVendorKMLimit, getVendorKMLimits } = require('../../../controllers/admin/others/VendorKMLimit');

// Base URL: /admin/vendor-km-limit

router.post('/set-km-limit', protect('admin'), setVendorKMLimit);
router.get('/get-km-limits', protect('admin'), getVendorKMLimits);

module.exports = router;