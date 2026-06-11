// routes/doctor/VideoCall.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware'); // protect common middleware to decode token
const { initiateVideoCall, respondToCall, endVideoCall } = require('../../controllers/doctor/VideoCall');

// Base URL: /doctor/video-call

// 1. Doctor triggers call -> sends push notification
router.post('/initiate', protect('doctor'), initiateVideoCall);

// 2. User accepts/rejects the call
router.post('/respond', protect('user'), respondToCall);

// 3. Call ends
router.post('/end', endVideoCall); // Token optional can be terminated by doctor/patient

module.exports = router;