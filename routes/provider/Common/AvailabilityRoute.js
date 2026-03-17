const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { setSlots, getMySlots } = require('../../../controllers/provider/Common/Availability'); // Apna Availability controller import karein

// Route: POST /provider/settings/availability
router.post('/settings/availability', protect('provider'), setSlots);
// Route: GET /provider/settings/my-slots
router.get('/settings/my-slots', protect('provider'), getMySlots);
module.exports = router;