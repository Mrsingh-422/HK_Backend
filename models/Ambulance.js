const mongoose = require('mongoose');

const ambulanceSchema = new mongoose.Schema({
    // --- Identification ---
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },
    name: { type: String, required: true },
    email: { type: String, unique: true, sparse: true, lowercase: true },
    phone: { type: String, unique: true, sparse: true },
    password: { type: String, required: true, select: false },
    role: { 
        type: String, 
        enum: ['ambulance', 'hospital-ambulance'], 
        default: 'ambulance' 
    },

    // --- Step 1: Location ---
    country: { type: String, default: null },
    state: { type: String, default: null },
    city: { type: String, default: null },
    address: { type: String, default: null },

    // --- Step 2: Driver Details ---
    drivingLicenseNumber: { type: String, default: null },
    licenseExpiryDate: { type: Date, default: null },
    experienceYears: { type: String, default: null },
    bloodGroup: { type: String, default: null },

    // --- Step 3: Vehicle Information ---
    vehicleNumber: { type: String, default: null },
    vehicleType: { 
        type: String, 
        enum: ['BLS', 'ALS', 'ICU Ambulance'], 
        default: 'BLS' 
    },
    rcNumber: { type: String, default: null },
    rcExpiryDate: { type: Date, default: null },
    insuranceNumber: { type: String, default: null },
    insuranceValidTill: { type: Date, default: null },

    // --- Step 4: Documents (Paths) ---
    documents: {
        drivingLicenseFile: { type: String, default: null },
        rcFile: { type: String, default: null },
        insuranceFile: { type: String, default: null },
        fitnessCertificate: { type: String, default: null },
        ambulancePermit: { type: String, default: null }
    },

    // --- Step 5: Availability Setup ---
    serviceRadius: { type: String, default: '5 km' }, // 5km, 10km, 20km
    availableForEmergency: { type: Boolean, default: true },

    // --- System ---
    isPhoneVerified: { type: Boolean, default: false },
    token: { type: String, default: null },
    profileStatus: { 
        type: String, 
        enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'], 
        default: 'Incomplete' 
    },
    rejectionReason: { type: String, default: null }

}, { timestamps: true });

module.exports = mongoose.model('Ambulance', ambulanceSchema);