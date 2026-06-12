// models/Call.js
const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true },
    callerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    callId: { type: String, required: true, unique: true },
    callerName: { type: String, required: true },
    
    // 👈 Added callType for Audio vs Video Call
    callType: { 
        type: String, 
        enum: ['audio', 'video'], 
        default: 'video' 
    },
    
    status: { 
        type: String, 
        enum: ['initiated', 'ringing', 'accepted', 'rejected', 'missed', 'completed'], 
        default: 'initiated' 
    },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    duration: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Call', callSchema);