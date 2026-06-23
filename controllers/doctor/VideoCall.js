// controllers/doctor/VideoCall.js
const Appointment = require('../../models/Appointment');
const User = require('../../models/User');
const Call = require('../../models/Call');
const admin = require('../../config/firebase');
const { getMessaging } = require('firebase-admin/messaging');
const mongoose = require('mongoose');

// 1. INITIATE VIDEO CALL (Triggered by Doctor)
const initiateVideoCall = async (req, res) => {
    try {
        const { appointmentId, callId, callerName ,callType = 'video'} = req.body;
        const doctorId = req.user.id; // From Auth Middleware (protect('doctor'))

        // A. Parameters Validation
        if (!appointmentId || !callId || !callerName) {
            return res.status(400).json({ 
                success: false, 
                message: "Missing required fields. 'appointmentId', 'callId', and 'callerName' are mandatory." 
            });
        }

        // B. Appointment Validation
        const appointment = await Appointment.findById(appointmentId).populate('userId');
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment not found." });
        }

        const patient = appointment.userId;
        if (!patient) {
            return res.status(404).json({ success: false, message: "Patient details not found for this appointment." });
        }

        // C. Database Safe Check: Prevent E11000 Duplicate Key Error
        let callData = await Call.findOne({ callId });

        if (callData) {
            callData.status = 'initiated';
            callData.startedAt = null;
            callData.endedAt = null;
            callData.callerName = callerName;
            callData.callType = callType; // 👈 Updated callType
            callData.appointmentId = appointmentId;
            callData.callerId = doctorId;
            callData.receiverId = patient._id;
            await callData.save();
        } else {
            callData = await Call.create({
                appointmentId,
                callerId: doctorId,
                receiverId: patient._id,
                callId,
                callerName,
                callType, // 👈 Updated callType
                status: 'initiated'
            });
        }

        // D. Push Notification Logic with Soft Fallback
        let notificationSent = false;
        let warningMessage = null;

        if (patient.fcmToken) {
            try {
                const message = {
                    token: patient.fcmToken,
                    data: {
                        type: 'VIDEO_CALL_INCOMING',
                        appointmentId: String(appointmentId),
                        receiverId: String(patient._id),
                        callerName: String(callerName),
                        callId: String(callId)
                    },
                    android: {
                        priority: 'high',
                        ttl: 0 
                    },
                    apns: {
                        payload: {
                            aps: {
                                contentAvailable: true 
                            }
                        }
                    }
                };

                // 👈 UPDATED TO MODULAR SYNTAX (getMessaging)
                await getMessaging().send(message); 
                notificationSent = true;
            } catch (fcmError) {
                console.error("FCM Push Failed:", fcmError.message);
                warningMessage = "Call room registered, but FCM push notification failed. Verify your Firebase Admin config.";
            }
        } else {
            console.warn(`[VideoCall Warning] Patient (${patient.name}) has no FCM Token.`);
            warningMessage = "Patient has no FCM Token registered. Notification not sent, but call room is created for WebRTC testing.";
        }

        res.status(200).json({ 
            success: true, 
            message: warningMessage ? "Call initiated with warnings." : "Call initiated & notification sent successfully.",
            notificationSent,
            warning: warningMessage,
            callData: callData 
        });

    } catch (error) {
        console.error("Critical error in initiateVideoCall:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. USER RESPOND TO CALL (Accept / Reject)
const respondToCall = async (req, res) => {
    try {
        const { callId, status } = req.body; // 'accepted' or 'rejected'
        
        if (!callId || !status) {
            return res.status(400).json({ success: false, message: "Both 'callId' and 'status' are required." });
        }

        if (!['accepted', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: "Status must be either 'accepted' or 'rejected'." });
        }

        const updateData = { status };
        if (status === 'accepted') {
            updateData.startedAt = new Date();
        }

        const updatedCall = await Call.findOneAndUpdate(
            { callId },
            { $set: updateData },
            { new: true }
        );

        if (!updatedCall) {
            return res.status(404).json({ success: false, message: "Call session not found with the provided callId." });
        }

        res.json({ success: true, message: `Call status updated to ${status}`, data: updatedCall });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. END VIDEO CALL (By Doctor or Patient)
const endVideoCall = async (req, res) => {
    try {
        const { callId, totalDurationInSeconds } = req.body;

        if (!callId) {
            return res.status(400).json({ success: false, message: "'callId' is required." });
        }

        const call = await Call.findOne({ callId });
        if (!call) {
            return res.status(404).json({ success: false, message: "Call session not found." });
        }

        call.status = 'completed';
        call.endedAt = new Date();
        
        if (totalDurationInSeconds !== undefined) {
            call.duration = Number(totalDurationInSeconds);
        } else if (call.startedAt) {
            call.duration = Math.round((new Date() - call.startedAt) / 1000); // Dynamically calculate seconds
        }
        
        await call.save();
        res.json({ success: true, message: "Call session ended and saved successfully.", data: call });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. GET WEBRTC ICE SERVERS (STUN) CONFIGURATION FOR DOCTOR
const getIceServers = async (req, res) => {
    try {
        const iceServers = [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:stun2.l.google.com:19302" },
            { urls: "stun:stun3.l.google.com:19302" },
            { urls: "stun:stun4.l.google.com:19302" }
        ];

        res.json({
            success: true,
            iceServers: iceServers
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    initiateVideoCall,
    respondToCall,
    endVideoCall,
    getIceServers // 👈 EXPORTED FOR DOCTOR
}; 