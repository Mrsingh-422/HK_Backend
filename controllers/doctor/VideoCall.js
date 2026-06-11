// controllers/doctor/VideoCall.js
const Appointment = require('../../models/Appointment');
const User = require('../../models/User');
const Call = require('../../models/Call');
const admin = require('../../config/firebase');

// 1. INITIATE VIDEO CALL (Triggered by Doctor)
const initiateVideoCall = async (req, res) => {
    try {
        const { appointmentId, callId, callerName } = req.body;
        const doctorId = req.user.id; // From Auth Middleware (protect('doctor'))

        // Appointment dynamic validation
        const appointment = await Appointment.findById(appointmentId).populate('userId');
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment not found." });
        }

        const patient = appointment.userId;
        if (!patient || !patient.fcmToken) {
            return res.status(400).json({ 
                success: false, 
                message: "Patient's FCM token is missing. Cannot send notification." 
            });
        }

        // Database me Call session create/save karein
        const newCall = await Call.create({
            appointmentId,
            callerId: doctorId,
            receiverId: patient._id,
            callId,
            callerName,
            status: 'initiated'
        });

        // FCM Data payload structure (Android/iOS background wake-up ke liye useful hai)
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
                priority: 'high', // Instant delivery ke liye high priority essential hai
                ttl: 0 // Immediate delivery, queueing bypass
            },
            apns: {
                payload: {
                    aps: {
                        contentAvailable: true // Background wake up for iOS
                    }
                }
            }
        };

        // Firebase messaging API integration
        await admin.messaging().send(message);

        res.status(200).json({ 
            success: true, 
            message: "Call initiated & Firebase Notification sent to patient successfully.", 
            callData: newCall 
        });

    } catch (error) {
        console.error("FCM Send Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. USER RESPOND TO CALL (Accept / Reject)
const respondToCall = async (req, res) => {
    try {
        const { callId, status } = req.body; // status can be 'accepted' or 'rejected'
        
        if (!['accepted', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status" });
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
            return res.status(404).json({ success: false, message: "Call session not found." });
        }

        res.json({ success: true, message: `Call status updated to ${status}`, data: updatedCall });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. END VIDEO CALL
const endVideoCall = async (req, res) => {
    try {
        const { callId, totalDurationInSeconds } = req.body; // Duration is optional

        const call = await Call.findOne({ callId });
        if (!call) {
            return res.status(404).json({ success: false, message: "Call session not found." });
        }

        call.status = 'completed';
        call.endedAt = new Date();
        if (totalDurationInSeconds) {
            call.duration = totalDurationInSeconds;
        } else if (call.startedAt) {
            call.duration = Math.round((new Date() - call.startedAt) / 1000); // Calculates dynamically
        }
        
        await call.save();
        res.json({ success: true, message: "Call session updated to completed successfully", data: call });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    initiateVideoCall,
    respondToCall,
    endVideoCall
};