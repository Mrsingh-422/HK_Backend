const mongoose = require('mongoose');

const doctorSchema = new mongoose.Schema({
    // Auth Fields (Sparse allows null/undefined values to not be unique)
    email: { type: String, unique: true, sparse: true }, 
    phone: { type: String, unique: true, sparse: true }, 
    
    password: { type: String, required: true, select: false },
    role: { type: String, default: 'doctor', immutable: true },

    // Profile Fields
    name: { type: String, required: true },
    address: { type: String, required: true },
    qualification: { type: String, required: true },
    speciality: { type: String, required: true },
    licenseNumber: { type: String, required: true },
    councilNumber: { type: String, required: true },
    token: { 
    type: String, 
    default: null 
},

    // Status
    profileStatus: { 
        type: String, 
        enum: ['Incomplete','Pending', 'Approved', 'Rejected'], 
        default: 'Incomplete' 
    },
    rejectionReason: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Doctor', doctorSchema);