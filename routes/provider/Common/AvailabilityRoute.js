const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { setSlots, getMySlots, blockSlot, unblockSlot } = require('../../../controllers/provider/Common/Availability');

// Base URL: /provider/availability

router.post('/set-slots', protect('provider'), setSlots);
router.get('/my-slots', protect('provider'), getMySlots);
router.post('/block-slot', protect('provider'), blockSlot);
router.post('/unblock-slot', protect('provider'), unblockSlot);

module.exports = router;