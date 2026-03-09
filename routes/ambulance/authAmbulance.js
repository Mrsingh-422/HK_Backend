const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { ambulanceDocUploads } = require('../../middleware/multer');
const { registerAmbulance, loginAmbulance, completeAmbulanceProfile } = require('../../controllers/ambulance/authAmbulance');

router.post('/register', registerAmbulance);
router.post('/login', loginAmbulance);
// Step 2 onwards requires token
router.put('/complete-profile', protect('ambulance'), ambulanceDocUploads, completeAmbulanceProfile);

module.exports = router;