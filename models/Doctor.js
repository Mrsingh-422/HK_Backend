const mongoose = require('mongoose');

const doctorSchema = new mongoose.Schema({
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },
    name: { type: String, required: true },
    email: { type: String, unique: true, sparse: true, lowercase: true }, 
    phone: { type: String, unique: true, sparse: true }, 
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['doctor', 'hospital-doctor'], default: 'doctor' },

    // Location
    country: { type: String, default: null },
    state: { type: String, default: null },
    city: { type: String, default: null },
    address: { type: String, default: null }, 

    // Verification & Auth
    isPhoneVerified: { type: Boolean, default: false },
    resetOTP: { type: String, default: null },
    token: { type: String, default: null },
    isActive: { type: Boolean, default: true },

    // Professional Info
    qualification: { type: String, default: null },
    speciality: { type: String, default: null }, 
    licenseNumber: { type: String, default: null },
    councilNumber: { type: String, default: null },
    councilName: { type: String, default: null },
    about: { type: String, default: null },
    experienceYears: { type: Number, default: 0 },
    languages: [{ type: String }], // Figma: Speaks (English, Hindi, etc.)

    // --- Figma: Select Consultation Type & Fees ---
    fees: {
        online: { type: Number, default: 0 }, // Video Consult
        clinic: { type: Number, default: 0 }, // Clinic Visit
        home: { type: Number, default: 0 }    // Home Visit
    },

    // --- Figma: Dynamic Slot Management ---
    slotDuration: { type: Number, default: 30 }, // 30 mins per patient
    availability: [{
        day: { type: String, enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
        startTime: String, // "09:00"
        endTime: String,   // "18:00"
        isLiveTrackingAvailable: { type: Boolean, default: false }
    }],

    // System Stats
    averageRating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
    profileImage: { type: String, default: null }, 
    documents: [{ type: String }], 

    profileStatus: { 
        type: String, 
        enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'], 
        default: 'Incomplete' 
    },
    rejectionReason: { type: String, default: null },

}, { timestamps: true });

module.exports = mongoose.model('Doctor', doctorSchema);