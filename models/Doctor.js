const mongoose = require('mongoose');

const doctorSchema = new mongoose.Schema({
    // --- Identification & Role ---
    // Hospital-doctor ke liye hospitalId store hogi, independent ke liye null rahega
    hospitalId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Hospital', 
        default: null 
    },
    name: { type: String, required: true },
    email: { type: String, unique: true, sparse: true, lowercase: true }, 
    phone: { type: String, unique: true, sparse: true }, 
    password: { type: String, required: true, select: false },
    role: { 
        type: String, 
        enum: ['doctor', 'hospital-doctor'], 
        default: 'doctor' 
    },

    // --- Location ---
    country: { type: String, default: null },
    state: { type: String, default: null },
    city: { type: String, default: null },
    address: { type: String, default: null }, 

    // --- Verification & Security ---
    isPhoneVerified: { type: Boolean, default: false },
    resetOTP: { type: String, default: null },
    token: { type: String, default: null },
    
    // 👇 YEH HAI ZAROORI FIELD: Iska default 'true' hona chahiye
    isActive: { type: Boolean, default: true },

    // --- Professional Info ---
    qualification: { type: String, default: null },
    speciality: { type: String, default: null }, 
    licenseNumber: { type: String, default: null },
    councilNumber: { type: String, default: null },
    councilName: { type: String, default: null },
    about: { type: String, default: null },

    // --- Hospital Specific (Checkboxes) ---
    department: {
        isNormal: { type: Boolean, default: false },
        isEmergency: { type: Boolean, default: false }
    },

    // --- Documents & Images ---
    profileImage: { type: String, default: null }, 
    documents: [{ type: String }], 

    // --- Approval Status ---
    profileStatus: { 
        type: String, 
        enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'], 
        default: 'Incomplete' 
    },
    rejectionReason: { type: String, default: null },

    // --- New Fields from Website/Figma Screenshots ---
    experienceYears: { type: Number, default: 0 },
    languages: [{ type: String }], // Speaks: English, Hindi, etc.
    
    // Fees for different consultation types
    fees: {
        online: { type: Number, default: 0 }, // Consult Online
        clinic: { type: Number, default: 0 }  // Visit Clinic
    },

    // Rating (Dynamic calculations ke liye)
    averageRating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },

    // Slots (Simple representation)
    availableDays: [{ type: String }], // ['Mon', 'Tue', 'Wed']
    workingHours: {
        start: { type: String }, // "09:00 AM"
        end: { type: String }    // "05:00 PM"
    }

}, { timestamps: true });

module.exports = mongoose.model('Doctor', doctorSchema);