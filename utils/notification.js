// utils/notification.js (DRIVER PUSH NOTIFICATION BUG FIXED)
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
const Driver = require('../models/Driver'); // 👈 Imported Driver Model
const { getMessaging } = require('firebase-admin/messaging'); // 👈 Modular import

const sendPushNotification = async (targetId, targetType, title, body, data = {}) => {
    try {
        if (!targetId || !targetType) return;

        let recipient;

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
            case 'driver':
                recipient = await Driver.findById(targetId).select('fcmToken');
                break;
            case 'ambulance':
                recipient = await Ambulance.findById(targetId).select('fcmToken');
                break;
            default:
                return;
        }

        const deviceToken = recipient ? recipient.fcmToken : null;

        if (deviceToken) {
            const stringifiedData = {};
            for (const key in data) {
                stringifiedData[key] = String(data[key]);
            }

            const message = {
                notification: { 
                    title: String(title), 
                    body: String(body) 
                },
                data: { 
                    ...stringifiedData, 
                    click_action: "FLUTTER_NOTIFICATION_CLICK" 
                },
                token: deviceToken
            };

            // 🚀 FIXED: Using getMessaging() safely
            await getMessaging().send(message);
            console.log(`✅ FCM Push sent to ${targetType} ID: ${targetId}`);
        }
    } catch (error) {
        console.error("❌ FCM Push Error:", error.message);
    }
};

const notifyAdminsAndVendor = async (vendorId, vendorType, title, body, data = {}) => {
    try {
        await sendPushNotification(vendorId, vendorType, title, body, data);
        const admins = await Admin.find({ isActive: true }).select('_id');
        const adminPromises = admins.map(adminUser => 
            sendPushNotification(adminUser._id, 'admin', title, body, data)
        );
        await Promise.all(adminPromises);
    } catch (error) {
        console.error("Multicast Notification Error:", error.message);
    }
};

module.exports = { sendPushNotification, notifyAdminsAndVendor };