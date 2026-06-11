// controllers/user/Doctor/VideoCall.js
const Call = require('../../../models/Call');
const User = require('../../../models/User'); // 👈 IMPORT ADDED (Fixes updateFcmToken crash)
const moment = require('moment');

// 1. GET ACTIVE INCOMING CALL (Ringing Screen Fallback Check)
// endpoint: GET /user/video-call/active
const getActiveIncomingCall = async (req, res) => {
    try {
        const userId = req.user.id; // From Auth Middleware (protect('user'))

        // Ringing Timeout Logic: Hum sirf pichle 45 seconds ke andar initiate hui calls ko hi active manenge.
        const ringingTimeoutLimit = new Date(Date.now() - 45000); // 45 seconds ago

        const activeCall = await Call.findOne({
            receiverId: userId,
            status: 'initiated', // Only show if still ringing
            createdAt: { $gte: ringingTimeoutLimit }
        }).populate('callerId', 'name speciality profileImage'); // Get doctor's basic info

        if (!activeCall) {
            return res.json({ 
                success: true, 
                hasActiveCall: false, 
                message: "No active incoming calls for this user." 
            });
        }

        res.json({
            success: true,
            hasActiveCall: true,
            callData: {
                callId: activeCall.callId,
                appointmentId: activeCall.appointmentId,
                callerName: activeCall.callerName,
                speciality: activeCall.callerId?.speciality || "General",
                doctorProfileImage: activeCall.callerId?.profileImage || null,
                createdAt: activeCall.createdAt
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. GET USER CALL HISTORY (Recent Call List / Call Notifications Log)
// endpoint: GET /user/video-call/history
const getUserCallHistory = async (req, res) => {
    try {
        const userId = req.user.id;

        const history = await Call.find({ receiverId: userId })
            .populate('callerId', 'name speciality profileImage')
            .sort({ createdAt: -1 }) // Newest calls first
            .limit(20); // Limit to last 20 calls for performance

        const formattedHistory = history.map(item => ({
            callId: item.callId,
            doctorName: item.callerName,
            doctorSpeciality: item.callerId?.speciality || "General",
            doctorImage: item.callerId?.profileImage || null,
            status: item.status, // 'completed', 'missed', 'rejected'
            startedAt: item.startedAt,
            duration: item.duration, // In seconds
            timeFormatted: moment(item.createdAt).fromNow() // e.g. "5 minutes ago"
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

// 3. UPDATE USER FCM TOKEN
// endpoint: PATCH /user/doctor/video-call/update-fcm
const updateFcmToken = async (req, res) => {
    try {
        const { fcmToken } = req.body;
        const userId = req.user.id; // Decoded from auth middleware

        if (!fcmToken) {
            return res.status(400).json({ 
                success: false, 
                message: "FCM token is required to update." 
            });
        }

        // Database me user document update karein
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: { fcmToken } },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        res.json({ 
            success: true, 
            message: "FCM Token updated successfully in user profile." 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. GET WEBRTC ICE SERVERS (STUN) CONFIGURATION FOR PATIENT
// endpoint: GET /user/doctor/video-call/ice-servers
const getIceServers = async (req, res) => {
    try {
        // Public STUN Servers for ICE candidates routing
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
    getActiveIncomingCall,
    getUserCallHistory,
    updateFcmToken,
    getIceServers // 👈 EXPORTED
};