const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true }, // Figma: "User" field
    email: { type: String, unique: true, sparse: true },
    phone: { type: String, unique: true, sparse: true },
    password: { type: String, required: true, select: false },
    
    // --- New Fields from Figma ---
    country: { type: String }, // ID or Name store kar sakte hain
    state: { type: String },
    city: { type: String },

    role: { type: String, default: 'user' },
    profileStatus: { type: String, default: 'Approved' },

    // Admin controlled dropdown (Previous requirement)
    insuranceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Insurance',
        default: null
    },

    // --- OTP Fields for Forgot Password ---
    resetPasswordOtp: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
    token: { 
        type: String, 
        default: null 
    },

}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);