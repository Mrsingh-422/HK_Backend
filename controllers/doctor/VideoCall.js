// controllers/doctor/VideoCall.js
const Appointment = require('../../models/Appointment');
const User = require('../../models/User');
const Call = require('../../models/Call');
const admin = require('../../config/firebase');
const { getMessaging } = require('firebase-admin/messaging');
const mongoose = require('mongoose');

// 1. Doctor triggers call
const initiateVideoCall = async (req, res) => {
    try {
        const { appointmentId, callId, callerName, callType = 'video' } = req.body;
        const doctorId = req.user.id;

        if (!appointmentId || !callId || !callerName) {
            return res.status(400).json({ 
                success: false, 
                message: "Missing required fields. 'appointmentId', 'callId', and 'callerName' are mandatory." 
            });
        }

        const appointment = await Appointment.findById(appointmentId).populate('userId');
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment not found." });
        }

        const patient = appointment.userId;
        if (!patient) {
            return res.status(404).json({ success: false, message: "Patient details not found for this appointment." });
        }

        // Set appointment progress
        appointment.status = 'In-Progress';
        await appointment.save();

        let callData = await Call.findOne({ callId });

        if (callData) {
            callData.status = 'initiated'; // Resets state
            callData.startedAt = new Date(); // Start logging initiation time
            callData.endedAt = null;
            callData.callerName = callerName;
            callData.callType = callType;
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
                callType,
                status: 'initiated',
                startedAt: new Date() // Start tracking instantly for missed call calculation
            });
        }

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
                    android: { priority: 'high', ttl: 0 },
                    apns: { payload: { aps: { contentAvailable: true } } }
                };

                await getMessaging().send(message); 
                notificationSent = true;
            } catch (fcmError) {
                warningMessage = "Call room registered, but FCM push notification failed.";
            }
        } else {
            warningMessage = "Patient has no FCM Token registered. Missed call log is active.";
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

// --- 2. RESPOND TO CALL ---
const respondToCall = async (req, res) => {
    try {
        const { callId, status } = req.body; // 'accepted' or 'rejected'
        
        if (!callId || !status) {
            return res.status(400).json({ success: false, message: "Both 'callId' and 'status' are required." });
        }

        const updateData = { status };
        if (status === 'accepted') {
            updateData.startedAt = new Date(); // Updates start time when actually accepted
        } else if (status === 'rejected') {
            updateData.endedAt = new Date(); // Log rejection timestamp
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

// --- 3. END VIDEO CALL (Handles Missed Call Timer Logs) ---
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

        const now = new Date();

        // 🚀 SYNC FIX: If call was never accepted by patient, log as missed call
        if (call.status === 'initiated' || call.status === 'ringing') {
            call.status = 'missed';
            call.endedAt = now;
            call.duration = 0; // Missed call duration remains 0
        } else {
            call.status = 'completed';
            call.endedAt = now;
            
            if (totalDurationInSeconds !== undefined) {
                call.duration = Number(totalDurationInSeconds);
            } else if (call.startedAt) {
                call.duration = Math.round((now - call.startedAt) / 1000); // Dynamically calculate seconds
            }
        }
        
        await call.save();
        res.json({ success: true, message: `Call session successfully recorded as ${call.status}.`, data: call });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// --- 4. GET DOCTOR CALL HISTORY (NEW API - For doctor dashboard call logs list) ---
// Endpoint: GET /doctor/video-call/history
// Path: controllers/doctor/VideoCall.js
const getDoctorCallHistory = async (req, res) => {
    try {
        const doctorId = req.user.id;

        const history = await Call.find({ callerId: doctorId })
            .populate('receiverId', 'name phone profilePic')
            .sort({ createdAt: -1 }) // Latest calls first
            .limit(20);

        const formattedHistory = history.map(item => ({
            callId: item.callId,
            patientName: item.receiverId?.name || item.callerName,
            patientPhone: item.receiverId?.phone || "N/A",
            patientImage: item.receiverId?.profilePic || null,
            status: item.status, // 'completed', 'missed', 'rejected', 'accepted'
            startedAt: item.startedAt,
            duration: item.duration, // in seconds
            timeFormatted: moment(item.createdAt).fromNow() // e.g. "2 hours ago"
        }));

        res.json({
            success: true,
            count: formattedHistory.length,
            data: formattedHistory
        });

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
    getDoctorCallHistory,
    getIceServers // 👈 EXPORTED FOR DOCTOR
}; 