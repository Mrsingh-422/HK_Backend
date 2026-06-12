// routes/chat/ChatRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware'); // Verify user token
const { getChatHistory } = require('../../../controllers/user/Doctor/ChatController');

// Base URL: /api/chat
router.get('/user/history/:appointmentId', protect('user'), getChatHistory); // 'protect' can accept both user or doctor
router.get('/doctor/history/:appointmentId', protect('doctor'), getChatHistory); // 'protect' can accept both user or doctor

module.exports = router;