// controllers/driver/common/DriverCommon.js
const Driver = require('../../../models/Driver');
const DriverNotification = require('../../../models/DriverNotification');

// 1. UPDATE LIVE GPS LOCATION (From Driver Mobile Background Service)
// Endpoint: PATCH /driver/common/location
const updateDriverLocation = async (req, res) => {
    try {
        const { lat, lng } = req.body;
        const driverId = req.user.id;

        if (lat === undefined || lng === undefined) {
            return res.status(400).json({ success: false, message: "Latitude (lat) and Longitude (lng) are required." });
        }

        const driver = await Driver.findByIdAndUpdate(
            driverId,
            { $set: { location: { lat: Number(lat), lng: Number(lng) } } },
            { new: true }
        ).select('name status location isOnline');

        res.json({
            success: true,
            message: "Driver location updated successfully.",
            location: driver.location
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. GET DRIVER NOTIFICATIONS
// Endpoint: GET /driver/common/notifications
const getDriverNotifications = async (req, res) => {
    try {
        const driverId = req.user.id;
        const notifications = await DriverNotification.find({ driverId })
            .sort({ createdAt: -1 })
            .limit(50);

        const unreadCount = await DriverNotification.countDocuments({ driverId, isRead: false });

        res.json({
            success: true,
            unreadCount,
            count: notifications.length,
            data: notifications
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. MARK NOTIFICATION AS READ
// Endpoint: PATCH /driver/common/notifications/read/:id
const markNotificationAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const driverId = req.user.id;

        await DriverNotification.findOneAndUpdate(
            { _id: id, driverId },
            { $set: { isRead: true } }
        );

        res.json({ success: true, message: "Notification marked as read." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. UPDATE DRIVER FCM TOKEN (When App Refreshes Token)
// Endpoint: PATCH /driver/common/fcm-token
const updateDriverFcmToken = async (req, res) => {
    try {
        const { fcmToken } = req.body;
        const driverId = req.user.id;

        if (!fcmToken) {
            return res.status(400).json({ success: false, message: "fcmToken is required." });
        }

        await Driver.findByIdAndUpdate(driverId, { $set: { fcmToken } });

        res.json({ success: true, message: "Driver FCM Token updated successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 5. DRIVER LOGOUT (Invalidate Session & Clear FCM Token)
// Endpoint: POST /driver/common/logout
const logoutDriver = async (req, res) => {
    try {
        const driverId = req.user.id;

        await Driver.findByIdAndUpdate(driverId, { 
            $set: { 
                token: null, 
                fcmToken: null, 
                status: 'Offline',
                isOnline: false 
            } 
        });

        res.json({ success: true, message: "Driver logged out successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = {
    updateDriverLocation,
    getDriverNotifications,
    markNotificationAsRead,
    updateDriverFcmToken,
    logoutDriver
};