// models/Nurse.js (Nurse Model)
const mongoose = require('mongoose');

const nurseSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, unique: true, sparse: true },
    phone: { type: String, unique: true, sparse: true },
    password: { type: String, required: true, select: false },
    role: { type: String, required: true }, // 'Lab', 'Pharmacy', 'Nurse'
    profileStatus: { type: String, enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'], default: 'Incomplete' },
    token: { type: String, default: null },
    isActive: { type: Boolean, default: true },

    profileImage: { type: String, default: null },
    
     // Location Details
    country: { type: String, default: null },
    state: { type: String, default: null },
    city: { type: String, default: null },
    address: { type: String, default: null },
    documents: [{ type: String }], // License, Certificates etc.

    location: {
        lat: Number,
        lng: Number
    },
        rejectionReason: { type: String, default: null },

}, { timestamps: true });

module.exports = mongoose.model('Nurse', nurseSchema);