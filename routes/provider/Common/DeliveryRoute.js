const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { saveDeliveryCharges, getMyDeliveryCharges } = require('../../../controllers/provider/Common/Delivery');

// Base URL: /provider/delivery-charges

router.post('/save', protect('provider'), saveDeliveryCharges);
router.get('/my-charges', protect('provider'), getMyDeliveryCharges);

module.exports = router;