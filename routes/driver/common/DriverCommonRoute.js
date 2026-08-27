// routes/driver/common/DriverCommonRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    updateDriverLocation, 
    getDriverNotifications, 
    markNotificationAsRead,
    updateDriverFcmToken,
    logoutDriver
} = require('../../../controllers/driver/common/DriverCommon');

// Base: /driver/common
router.patch('/location', protect('driver'), updateDriverLocation);
router.patch('/fcm-token', protect('driver'), updateDriverFcmToken);
router.post('/logout', protect('driver'), logoutDriver);
router.get('/notifications', protect('driver'), getDriverNotifications);
router.patch('/notifications/read/:id', protect('driver'), markNotificationAsRead);

module.exports = router;