// utils/notification.js
const admin = require('firebase-admin'); 

// 🚨 IN IMPORTS KO ADD KAREIN (Relative paths as per your project structure)
const User = require('../models/User'); 
const Ambulance = require('../models/Ambulance'); 

const sendPushNotification = async (targetId, targetType, title, body, data = {}) => {
    try {
        let recipient;
        if (targetType === 'user') {
            recipient = await User.findById(targetId).select('token');
        } else {
            recipient = await Ambulance.findById(targetId).select('token');
        }

        if (recipient && recipient.token) {
            const message = {
                notification: { title, body },
                data: { ...data, click_action: "FLUTTER_NOTIFICATION_CLICK" },
                token: recipient.token
            };
            await admin.messaging().send(message);
            console.log(`FCM Push successfully sent to ${targetType} ID: ${targetId}`);
        }
    } catch (error) {
        console.error("FCM Push Error:", error.message);
    }
};

module.exports = { sendPushNotification };