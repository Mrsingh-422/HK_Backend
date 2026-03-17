// const mongoose = require('mongoose');
// const hospitalDoctorSchema = new mongoose.Schema({
// // Hospital Link
// hospitalId: {
// type: mongoose.Schema.Types.ObjectId,
// ref: 'Hospital',
// required: true
// },

// // Auth & Identity (Sparse Logic for Email/Phone)
// name: { type: String, required: true },
// email: { type: String, unique: true, sparse: true, lowercase: true }, 
// phone: { type: String, unique: true, sparse: true }, 
// password: { type: String, required: true, select: false },
// role: { type: String, default: 'hospital-doctor', immutable: true },

// // Location (Same as Doctor Model)
// country: { type: String, default: null },
// state: { type: String, default: null },
// city: { type: String, default: null },
// address: { type: String, default: null }, 

// // Verification & Security
// isPhoneVerified: { type: Boolean, default: false },
// resetOTP: { type: String, default: null }, 
// token: { type: String, default: null },

// // Professional Info (Screenshot fields)
// qualification: { type: String, default: null },
// speciality: { type: String, default: null }, 
// licenseNumber: { type: String, default: null },
// councilName: { type: String, default: null },   // Medical Council Name
// councilNumber: { type: String, default: null }, // Medical Council Number
// about: { type: String, default: null },

// // Department logic (Normal/Emergency)
// department: {
//     isNormal: { type: Boolean, default: false },
//     isEmergency: { type: Boolean, default: false }
// },

// // Images & Documents (Array logic as requested)
// profileImage: { type: String, default: null }, 
// documents: [{ type: String }], 

// // Status
// isActive: { type: Boolean, default: true },
// profileStatus: { 
//     type: String, 
//     enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'], 
//     default: 'Approved' // Hospital doctors are usually pre-approved
// },
// rejectionReason: { type: String, default: null }
// }, { timestamps: true });
// module.exports = mongoose.model('HospitalDoctor', hospitalDoctorSchema);