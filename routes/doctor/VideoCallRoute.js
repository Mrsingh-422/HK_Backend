// routes/doctor/VideoCall.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware'); // protect common middleware to decode token
const { 
    initiateVideoCall, 
    respondToCall, 
    endVideoCall,getDoctorCallHistory,
    getIceServers // 👈 IMPORTED FOR DOCTOR
} = require('../../controllers/doctor/VideoCall');

// Base URL: /doctor/video-call

// 1. Doctor triggers call -> sends push notification
router.post('/initiate', protect('doctor'), initiateVideoCall);

// 2. User/Doctor responds to status
router.post('/respond', protect('user'), respondToCall);

// 3. Call ends
router.post('/end', endVideoCall); 

router.get('/history', protect('doctor'), getDoctorCallHistory);

// 4. Fetch WebRTC ICE Servers (STUN Config) for Doctor Peer Connection
router.get('/ice-servers', protect('doctor'), getIceServers); // 👈 ADDED

module.exports = router;