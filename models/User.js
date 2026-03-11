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

userAddress: [{
        addressType: { type: String, enum: ['Home', 'Work', 'Other'], default: 'Home' },
        phone: String,
        pincode: String,
        houseNo: String,
        sector: String,
        landmark: String,
        city: String,
        state: String,
        country: String,
        isDefault: { type: Boolean, default: false }
    }],

 familyMember: [{
        memberName: String,
        relation: String, // Spouse, Child, Parent, etc.
        age: Number,
        phone: String,
        gender: { type: String, enum: ['Male', 'Female', 'Other'] },
        profilePic: { type: String, default: null }
    }],
     emergencyContact: [{
        contactName: String,
        phone: String,
        relation: String // Friend, Brother, etc.
    }],

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