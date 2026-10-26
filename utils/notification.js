// utils/notification.js (DRIVER PUSH NOTIFICATION BUG FIXED)
const admin = require('firebase-admin'); 
require('../config/firebase'); // 👈 Guarantees Firebase is initialized before messaging calls

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
const UserNotification = require('../models/UserNotification'); // 👈 Imported UserNotification Model
const { getMessaging } = require('firebase-admin/messaging'); // 👈 Modular import

// @desc    Dispatches FCM push notification (High Priority) & logs persistent UserNotification in MongoDB
const sendPushNotification = async (targetId, targetType, title, body, data = {}) => {
    try {
        if (!targetId || !targetType) return;

        const cleanTargetId = targetId?._id ? targetId._id : targetId;

        // 1. Always save in MongoDB UserNotification inbox if recipient is a patient/user
        if (targetType === 'user') {
            try {
                await UserNotification.create({
                    userId: cleanTargetId,
                    title: String(title),
                    message: String(body),
                    type: data.type || 'GENERAL',
                    serviceType: data.serviceType || 'General',
                    data: data || {}
                });
                console.log(`📥 [In-App Notification Saved] for User: ${cleanTargetId}`);
            } catch (dbErr) {
                console.error("❌ Error saving UserNotification to MongoDB:", dbErr.message);
            }
        }

        let recipient;
        switch (targetType) {
            case 'user':
                recipient = await User.findById(cleanTargetId).select('fcmToken');
                break;
            case 'admin':
                recipient = await Admin.findById(cleanTargetId).select('fcmToken');
                break;
            case 'doctor':
                recipient = await Doctor.findById(cleanTargetId).select('fcmToken');
                break;
            case 'hospital':
                recipient = await Hospital.findById(cleanTargetId).select('fcmToken');
                break;
            case 'lab':
                recipient = await Lab.findById(cleanTargetId).select('fcmToken');
                break;
            case 'nurse':
                recipient = await Nurse.findById(cleanTargetId).select('fcmToken');
                break;
            case 'pharmacy':
                recipient = await Pharmacy.findById(cleanTargetId).select('fcmToken');
                break;
            case 'driver':
                recipient = await Driver.findById(cleanTargetId).select('fcmToken');
                break;
            case 'ambulance':
                recipient = await Ambulance.findById(cleanTargetId).select('fcmToken');
                break;
            default:
                return;
        }

        const deviceToken = recipient ? recipient.fcmToken : null;

        if (deviceToken) {
            const stringifiedData = {};
            for (const key in data) {
                if (data[key] !== undefined && data[key] !== null) {
                    stringifiedData[key] = String(data[key]);
                }
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
                android: {
                    priority: "high",
                    notification: {
                        sound: "default",
                        channelId: "high_importance_channel",
                        defaultVibrateTimings: true,
                        defaultSound: true
                    }
                },
                apns: {
                    headers: {
                        "apns-priority": "10"
                    },
                    payload: {
                        aps: {
                            sound: "default",
                            badge: 1,
                            contentAvailable: true
                        }
                    }
                },
                token: deviceToken
            };

            await getMessaging().send(message);
            console.log(`✅ FCM Push dispatched to ${targetType} ID: ${cleanTargetId}`);
        } else {
            console.log(`ℹ️ [FCM Skipped]: User ${cleanTargetId} has no fcmToken registered on device.`);
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