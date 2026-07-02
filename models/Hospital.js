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
    alternatePhone: { type: String, default: null },
    // --- SYSTEM FIELDS ---
    role: { type: String, default: 'hospital', immutable: true },
    token: { type: String, default: null },
    fcmToken: { 
        type: String, 
        default: null 
    },
    location: {
        lat: { type: Number, default: 0 },
        lng: { type: Number, default: 0 }
    },
    isActive: { type: Boolean, default: true },
    
    // Approval Status
    profileStatus: {
        type: String,
        enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'],
        default: 'Incomplete'
    },
    rejectionReason: { type: String },
    termsAndConditions: { type: String, default: "" },

    bankDetails: {
        accountType: { type: String, enum: ['Savings', 'Current'], default: 'Savings' },
        bankName: { type: String, default: "" },
        accountHolderName: { type: String, default: "" },
        accountNumber: { type: String, default: "" },
        ifscCode: { type: String, default: "" },
        upiId: { type: String, default: "" },
        isVerified: { type: Boolean, default: false }
    }

}, { timestamps: true });

module.exports = mongoose.model('Hospital', hospitalSchema);