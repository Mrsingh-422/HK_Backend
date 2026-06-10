const mongoose = require('mongoose');
const policeStaffSchema = new mongoose.Schema({
    stationId: { type: mongoose.Schema.Types.ObjectId, ref: 'PoliceStation', required: true },
    hqId: { type: mongoose.Schema.Types.ObjectId, ref: 'PoliceHQ', required: true },
    fullName: { type: String, required: true },
    badgeId: { type: String, required: true, unique: true }, // Unique Badge Number
    rank: { type: String, required: true }, // Inspector, SI, Constable
    officialEmail: { type: String, required: true, unique: true },
    mobileNumber: { type: String, required: true, unique: true },
    password: { type: String, required: true, select: false },
    profileImage: { type: String, default: null },
    status: { type: String, enum: ['On Duty', 'On Leave', 'Suspended'], default: 'On Duty' },
    shift: { 
        type: String, 
        enum: ['Shift A (08:00 - 16:00)', 'Shift B (16:00 - 00:00)', 'Night Shift', 'Off Duty'], 
        default: 'Off Duty' 
    },
    lastCheckIn: { type: Date, default: null }, // Checked-in time tracking ke liye
    location: {
        lat: { type: Number, default: 0 },
        lng: { type: Number, default: 0 }
    },
    role: { type: String, default: 'Police-Staff', immutable: true },
    token: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('PoliceStaff', policeStaffSchema);