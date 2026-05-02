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
    primarySectors: [{
        sectorName: { type: String }, // e.g., "Sector A: Central Commercial"
        description: { type: String }, // e.g., "MI Road, Sindhi Camp & surrounding..."
        iconType: { type: String } // "Commercial", "Residential", "Industrial"
    }],

    jurisdictionStats: {
        totalArea: { type: String, default: "42.5 km²" },
        population: { type: String, default: "~850,000" },
        activeZones: { type: String, default: "4 Main Zones" },
        riskLevel: { type: String, default: "Moderate- High" }
    },
    
    // Auth related
    otp: { type: String, select: false },
    otpExpires: { type: Date, select: false },
    token: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('FireHQ', fireHQSchema);