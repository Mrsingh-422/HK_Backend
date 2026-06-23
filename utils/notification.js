// utils/notification.js
const admin = require('firebase-admin'); 

// Schema imports
const User = require('../models/User'); 
const Ambulance = require('../models/Ambulance'); 
const Admin = require('../models/Admin');
const Doctor = require('../models/Doctor');
const Hospital = require('../models/Hospital');
const Lab = require('../models/Lab');
const Nurse = require('../models/Nurse');
const Pharmacy = require('../models/Pharmacy');

const sendPushNotification = async (targetId, targetType, title, body, data = {}) => {
    try {
        let recipient;

        // 🚨 Strictly querying 'fcmToken' instead of auth JWT 'token'
        switch (targetType) {
            case 'user':
                recipient = await User.findById(targetId).select('fcmToken');
                break;
            case 'admin':
                recipient = await Admin.findById(targetId).select('fcmToken');
                break;
            case 'doctor':
                recipient = await Doctor.findById(targetId).select('fcmToken');
                break;
            case 'hospital':
                recipient = await Hospital.findById(targetId).select('fcmToken');
                break;
            case 'lab':
                recipient = await Lab.findById(targetId).select('fcmToken');
                break;
            case 'nurse':
                recipient = await Nurse.findById(targetId).select('fcmToken');
                break;
            case 'pharmacy':
                recipient = await Pharmacy.findById(targetId).select('fcmToken');
                break;
            case 'ambulance':
            case 'driver':
                recipient = await Ambulance.findById(targetId).select('fcmToken');
                break;
            default:
                console.error("FCM Push Error: Invalid targetType provided -", targetType);
                return;
        }

        const deviceToken = recipient ? recipient.fcmToken : null;

        if (deviceToken) {
            const message = {
                notification: { title, body },
                data: { ...data, click_action: "FLUTTER_NOTIFICATION_CLICK" },
                token: deviceToken
            };
            await admin.messaging().send(message);
            console.log(`FCM Push successfully sent to ${targetType} ID: ${targetId}`);
        } else {
            console.warn(`FCM Push Warning: No fcmToken found for ${targetType} ID: ${targetId}`);
        }
    } catch (error) {
        console.error("FCM Push Error:", error.message);
    }
};

const notifyAdminsAndVendor = async (vendorId, vendorType, title, body, data = {}) => {
    try {
        // 1. Notify the Specific Vendor
        await sendPushNotification(vendorId, vendorType, title, body, data);

        // 2. Fetch all active platform Admins and notify them
        const admins = await Admin.find({ isActive: true }).select('_id');
        const adminPromises = admins.map(adminUser => 
            sendPushNotification(adminUser._id, 'admin', title, body, data)
        );
        await Promise.all(adminPromises);
    } catch (error) {
        console.error("Admins & Vendor Multicast Notification Error:", error.message);
    }
};

module.exports = { sendPushNotification, notifyAdminsAndVendor };