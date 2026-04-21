const mongoose = require('mongoose');
const policeHQSchema = new mongoose.Schema({
    hqName: { type: String, required: true }, 
    commissionerName: { type: String, required: true }, 
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true, unique: true },
    landline: { type: String },
    password: { type: String, required: true, select: false },
    
    country: { type: String, default: 'India' },
    state: { type: String },
    city: { type: String },
    address: { type: String },
    location: {
        lat: { type: Number, default: 0 },
        lng: { type: Number, default: 0 }
    },
    profileImage: { type: String, default: null },
    role: { type: String, default: 'Police-HQ', immutable: true },
    isActive: { type: Boolean, default: true },
    otp: { type: String, select: false },
    otpExpires: { type: Date, select: false },
    token: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('PoliceHQ', policeHQSchema);