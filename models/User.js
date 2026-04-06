const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true }, // Figma: "User" field
    email: { type: String, unique: true, sparse: true },
    phone: { type: String, unique: true, sparse: true },
    password: { type: String, required: true, select: false },

    profilePic: { type: String, default: null },

    // --- New Fields from Figma ---
    countryCode: { type: String }, // +91, +1, etc.

    fatherName: { type: String },
    weight: { type: String }, // e.g., "61 kg"
    gender: { type: String, enum: ['Male', 'Female', 'Other'] },
    dob: { type: Date },      // Date of Birth
    height: { type: String }, // e.g., "5'9"

    country: { type: String }, // ID or Name store kar sakte hain
    state: { type: String },
    city: { type: String },

     workDetails: {
        companyName: { type: String },
        address: { type: String },
        city: { type: String },
        state: { type: String },
        pincode: { type: String },
        mobileNumber: { type: String }
    },

    // --- Medical Details: Family History (Figma Screen: Family History) ---
    // Options: 'None', 'Either Parent', 'Both parents'
    familyHistory: {
    diabetes: { 
        type: String, 
        enum: ['None', 'Either Parent', 'Both parents'], 
        default: 'None' 
    },
    highCholesterol: { 
        type: String, 
        enum: ['None', 'Either Parent', 'Both parents'], 
        default: 'None' 
    },
    hypertension: { 
        type: String, 
        enum: ['None', 'Either Parent', 'Both parents'], 
        default: 'None' 
    },
    obesity: { 
        type: String, 
        enum: ['None', 'Either Parent', 'Both parents'], 
        default: 'None' 
    }
},

    // --- Medical Details: Conditions & Allergies (Figma Screen: Conditions & Allergies) ---
   conditionStatus: {
        asthma: { type: Boolean, default: false },
        diabetes: { type: Boolean, default: false },
        heartDisease: { type: Boolean, default: false },
        hypertension: { type: Boolean, default: false },
        addedConditions: [{ type: String }], 
        addedAllergies: [{ type: String }]
    },

    // --- Health Insurance Details (Figma Screen: Health Insurance Edit/Add) ---
    insuranceDetails: {
        hasInsurance: { type: Boolean, default: false },
        insuranceNumber: { type: String },
        companyName: { type: String },
        insuranceType: { type: String }, // e.g., "Individual", "Family Float"
        startDate: { type: String },
        endDate: { type: String },
        // Reference if needed for master data
        masterInsuranceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Insurance', default: null }
    },

 
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
        memberName: { type: String },
        relation: { type: String }, 
        dob: { type: String },
        phone: { type: String },
        gender: { type: String },
        height: { type: String },
        weight: { type: String },
        insuranceNo: { type: String },
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


    role: { type: String, default: 'user' },
    profileStatus: { type: String, default: 'Approved' },

    // --- OTP Fields for Forgot Password ---
    resetPasswordOtp: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
    token: {
        type: String,
        default: null
    },

}, { timestamps: true });

module.exports = mongoose.model('User', userSchema); 