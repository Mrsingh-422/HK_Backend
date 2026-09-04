// models/OtpRateLimitConfig.js
const mongoose = require('mongoose');

const otpRateLimitConfigSchema = new mongoose.Schema({
    otpType: {
        type: String,
        enum: ['Phone-OTP', 'Email-OTP','Registration-OTP', 'Universal-All'],
        required: true,
        unique: true
    },
    maxAttempts: {
        type: Number,
        default: 3 // 👈 24 hours me max 3 OTP requests
    },
    windowInHours: {
        type: Number,
        default: 24 // 👈 24 Hours cooldown window
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('OtpRateLimitConfig', otpRateLimitConfigSchema);