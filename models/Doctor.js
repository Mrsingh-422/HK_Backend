const mongoose = require('mongoose');

const doctorSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, unique: true, sparse: true, lowercase: true }, 
    phone: { type: String, unique: true, sparse: true }, 
    password: { type: String, required: true, select: false },
    role: { type: String, default: 'doctor', immutable: true },

    // Location
    country: { type: String, default: null },
    state: { type: String, default: null },
    city: { type: String, default: null },
    address: { type: String, default: null }, 

    // Verification & Security
    isPhoneVerified: { type: Boolean, default: false },
    resetOTP: { type: String, default: null },

    // Professional Info
    qualification: { type: String, default: null },
    speciality: { type: String, default: null }, 
    licenseNumber: { type: String, default: null },
    councilNumber: { type: String, default: null },
    councilName: { type: String, default: null }, // 👈 Added Council Name

    // Documents (Figma: Profile Upload + Certificate Upload)
    profileImage: { type: String, default: null }, 
    documents: [{ type: String }], 

    token: { type: String, default: null },

    profileStatus: { 
        type: String, 
        enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'], 
        default: 'Incomplete' 
    },
    rejectionReason: { type: String, default: null }

}, { timestamps: true });

module.exports = mongoose.model('Doctor', doctorSchema);