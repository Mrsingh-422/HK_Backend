const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { saveDeliveryCharges, getMyDeliveryCharges } = require('../../../controllers/provider/Common/Coupon'); // Apna Coupon controller import karein

// Route: POST /provider/delivery

router.post('/charges', protect('provider'), saveDeliveryCharges);
router.get('/charges', protect('provider'), getMyDeliveryCharges);

module.exports = router;