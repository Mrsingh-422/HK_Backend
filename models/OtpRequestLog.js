// models/OtpRequestLog.js
const mongoose = require('mongoose');

const otpRequestLogSchema = new mongoose.Schema({
    identifier: { 
        type: String, 
        required: true, 
        index: true 
    }, // Clean 10-digit Phone, Email, ya IP Address
    identifierType: { 
        type: String, 
        enum: ['phone', 'email', 'ip'], 
        required: true 
    },
    otpType: { 
        type: String, 
        enum: ['Phone-OTP', 'Email-OTP','Registration-OTP', 'Universal-All'], 
        default: 'Universal-All' 
    },
    clientIp: { type: String },
    requestedAt: { 
        type: Date, 
        default: Date.now, 
        expires: 172800 // 👈 TTL Index: 48 Hours baad auto-cleanup
    }
}, { timestamps: true });

otpRequestLogSchema.index({ identifier: 1, requestedAt: -1 });

module.exports = mongoose.model('OtpRequestLog', otpRequestLogSchema);