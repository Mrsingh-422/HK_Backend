const mongoose = require('mongoose');
 
const policeStationSchema = new mongoose.Schema({
    hqId: { type: mongoose.Schema.Types.ObjectId, ref: 'PoliceHQ', required: true },
    stationName: { type: String, required: true },
    stationCode: { type: String, unique: true, required: true }, // e.g., PS-JAIPUR-05
    shoName: { type: String, required: true }, // Station House Officer
    jurisdiction: {
        zoneName: { type: String, default: "Central District - Sector 4" },
        sqKmArea: { type: Number, default: 12.5 },
        population: { type: String, default: "450k" },
        patrolBeats: { type: Number, default: 8 },
        boundaryLimits: {
            north: { type: String, default: "Grand Northern Highway" },
            south: { type: String, default: "Pearl River Embankment" },
            east: { type: String, default: "Downtown Financial Ave" },
            west: { type: String, default: "Western Industrial Park" }
        },
        areaDocumentUrl: { type: String, default: "/uploads/jurisdiction/area-doc-central.pdf" }
    },
    preferences: {
        newFirNotifications: { type: Boolean, default: true },
        emergencyBroadcasts: { type: Boolean, default: true }
    },
    // 🚨 NAYI KEYS YAHAN ADD KI GAYI HAIN (Help, Privacy, Terms ke liye)
    documentation: {
        help: {
            title: { type: String, default: "Help & Documentation" },
            content: { type: String, default: "Welcome to Help & Support. Please refer to standard FAQs or contact administration." },
            contactPhone: { type: String, default: "+91 9876543210" },
            contactEmail: { type: String, default: "help@healthkangaroo.com" }
        },
        privacy: {
            title: { type: String, default: "Privacy & Security" },
            content: { type: String, default: "1. Confidentiality: All police records are highly confidential. Unauthorized sharing is punishable by law." }
        },
        terms: {
            title: { type: String, default: "Standard Terms & Conditions" },
            content: { type: String, default: "1. Incorporation Into Agreements. These Terms and Conditions apply..." }
        }
    },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true, unique: true },
    emergencyLines: { type: String }, // e.g., 100, 112
    password: { type: String, required: true, select: false },
    address: { type: String },
    location: {
        lat: { type: Number, default: 0 },
        lng: { type: Number, default: 0 }
    },
    profileImage: { type: String, default: null },
    role: { type: String, default: 'Police-Station', immutable: true },
    isActive: { type: Boolean, default: true },
    otp: { type: String, select: false },
    token: { type: String, default: null }
}, { timestamps: true });
 
module.exports = mongoose.model('PoliceStation', policeStationSchema);
 