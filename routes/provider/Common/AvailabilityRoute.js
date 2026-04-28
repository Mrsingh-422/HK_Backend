const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { setSlots, getMySlots, blockSlot, unblockSlot,setNurseAvailability, getMyNurseSlots, toggleNurseSlot } = require('../../../controllers/provider/Common/Availability');

// Base URL: /provider/availability

router.post('/set-slots', protect('provider'), setSlots);
router.get('/my-slots', protect('provider'), getMySlots);
router.post('/block-slot', protect('provider'), blockSlot);
router.post('/unblock-slot', protect('provider'), unblockSlot);

router.post('/set-nurse-slots', protect('nurse'), setNurseAvailability);
router.get('/my-nurse-slots', protect('nurse'), getMyNurseSlots);
router.post('/toggle-nurse-slot', protect('nurse'), toggleNurseSlot);

module.exports = router;