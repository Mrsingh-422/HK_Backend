// models/Call.js
const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true },
    callerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true }, // Doctor
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },   // User/Patient
    callId: { type: String, required: true, unique: true }, // WebRTC session ID (passed from Frontend)
    callerName: { type: String, required: true },
    status: { 
        type: String, 
        enum: ['initiated', 'ringing', 'accepted', 'rejected', 'missed', 'completed'], 
        default: 'initiated' 
    },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    duration: { type: Number, default: 0 } // duration in seconds
}, { timestamps: true });

module.exports = mongoose.model('Call', callSchema);