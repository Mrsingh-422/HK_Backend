const mongoose = require('mongoose');
const policeStationSchema = new mongoose.Schema({
    hqId: { type: mongoose.Schema.Types.ObjectId, ref: 'PoliceHQ', required: true },
    stationName: { type: String, required: true },
    stationCode: { type: String, unique: true, required: true }, // e.g., PS-JAIPUR-05
    shoName: { type: String, required: true }, // Station House Officer
    jurisdictionArea: { type: String },
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