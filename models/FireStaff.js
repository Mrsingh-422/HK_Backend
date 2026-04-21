const mongoose = require('mongoose');

const fireStaffSchema = new mongoose.Schema({
    stationId: { type: mongoose.Schema.Types.ObjectId, ref: 'FireStation', required: true },
    hqId: { type: mongoose.Schema.Types.ObjectId, ref: 'FireHQ', required: true },
    
    fullName: { type: String, required: true },
    badgeId: { type: String, required: true, unique: true }, // Figma: #894-STN-02
    rank: { type: String, required: true }, // Figma: Assistant Sub-Inspector / Firefighter
    mobileNumber: { type: String, required: true, unique: true },
    officialEmail: { type: String, required: true, unique: true },
    password: { type: String, required: true, select: false },
    address: { type: String },
    profileImage: { type: String, default: null },

    // Operational Stats (Screen 13)
    joiningDate: { type: Date },
    attendance: { type: Number, default: 0 }, // 96% in figma
    activeCases: { type: Number, default: 0 },
    
    role: { type: String, default: 'Fire-Staff', immutable: true },
    status: { type: String, enum: ['Active', 'On Leave', 'Inactive'], default: 'Active' },
    
    // Auth related
    otp: { type: String, select: false },
    otpExpires: { type: Date, select: false },
    token: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('FireStaff', fireStaffSchema);