const mongoose = require('mongoose');

const fireStationSchema = new mongoose.Schema({
    hqId: { type: mongoose.Schema.Types.ObjectId, ref: 'FireHQ', required: true }, // HQ link
    stationName: { type: String, required: true },
    stationCode: { type: String, unique: true, required: true }, // Figma: FS-JAIPUR-01
    captainName: { type: String, required: true }, // Commanding Officer
    operatingZone: { type: String }, // Figma: Central Jaipur District
    
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true, unique: true },
    landline: { type: String },
    emergencyLines: { type: String }, // Figma: 101, 112
    officeDesk: { type: String }, // Figma: Office Desk Phone
    
    password: { type: String, required: true, select: false },
    address: { type: String },
    location: {
        lat: Number,
        lng: Number
    },
    profileImage: { type: String, default: null },
    
    role: { type: String, default: 'Fire-Station', immutable: true },
    isActive: { type: Boolean, default: true },

    jurisdiction: {
        totalArea: { type: String, default: "42.5 km²" },
        population: { type: String, default: "~850,000" },
        activeZones: { type: Number, default: 4 },
        riskLevel: { type: String, default: "Moderate-High" }
    },
    
    // Auth
    otp: { type: String, select: false },
    otpExpires: { type: Date, select: false },
    token: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('FireStation', fireStationSchema);