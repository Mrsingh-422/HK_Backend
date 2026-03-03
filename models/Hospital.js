const { required } = require('joi');
const mongoose = require('mongoose');

const hospitalSchema = new mongoose.Schema({
    // --- AUTH FIELDS ---
    email: { type: String, unique: true, sparse: true },
    phone: { type: String, unique: true, sparse: true },
    password: { type: String, required: true, select: false },
    
    // OTP Fields (For Forgot Password)
    resetPasswordOtp: { type: String },
    resetPasswordExpires: { type: Date },

    // --- PROFILE FIELDS (Matches Figma Register Screen) ---
    name: { type: String, required: true }, // Hospital Name
    
    // Address Breakdown
    country: { type: String },
    state: { type: String },
    city: { type: String },
    zipCode: { type: String },
    address: { type: String }, // Full address string if needed

    // Classification
    type: {
        type: String,
        enum: ['Govt', 'Private', 'Charity'], // Figma "Register As" options
        default: 'Private',
        required: true
    },

    // --- DOCUMENTS (Multiple Images Support) ---
    // Stores array of URL strings (e.g., ["url1.jpg", "url2.jpg"])
    hospitalImage: [{ type: String }], 
    licenseDocument: [{ type: String }],
    otherDocuments: [{ type: String }],

    // --- SYSTEM FIELDS ---
    role: { type: String, default: 'hospital', immutable: true },
    token: { type: String, default: null },
    
    // Approval Status
    profileStatus: {
        type: String,
        enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'],
        default: 'Incomplete'
    },
    rejectionReason: { type: String }

}, { timestamps: true });

module.exports = mongoose.model('Hospital', hospitalSchema);