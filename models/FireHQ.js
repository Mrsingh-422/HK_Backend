// models/FireHQ.js
const mongoose = require('mongoose');

const fireHQSchema = new mongoose.Schema({
    stationName: { type: String, required: true }, // Figma: Fire Station Name
    captainName: { type: String, required: true },  // Figma: Captain Name
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true, unique: true },
    landline: { type: String }, // Figma: Landline
    password: { type: String, required: true, select: false },
    
    // Location details from Screen 21
    country: { type: String, default: 'India' },
    state: { type: String },
    city: { type: String },
    address: { type: String },

    profileImage: { type: String, default: null },
    role: { type: String, default: 'Fire-HQ', immutable: true },
    isActive: { type: Boolean, default: true },
    
    // Auth related
    otp: { type: String, select: false },
    otpExpires: { type: Date, select: false },
    token: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('FireHQ', fireHQSchema);