// routes/user/doctor/VideoCall.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware'); // Auth middleware to authenticate user/patient
const { 
    getActiveIncomingCall, 
    getUserCallHistory, 
    updateFcmToken,
    getIceServers // 👈 IMPORTED
} = require('../../../controllers/user/Doctor/VideoCall');

// Base URL context: /user/doctor/video-call

// 1. API to fetch active ringing session (Checks if someone is calling you right now)
router.get('/active', protect('user'), getActiveIncomingCall);

// 2. API to get all previous call notifications / history logs
router.get('/history', protect('user'), getUserCallHistory);

// 3. API to update user's FCM token
router.patch('/update-fcm', protect('user'), updateFcmToken);

// 4. API to fetch WebRTC Ice Servers Configuration (STUN/TURN)
router.get('/ice-servers', protect('user'), getIceServers); // 👈 ADDED

module.exports = router;