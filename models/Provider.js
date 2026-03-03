const mongoose = require('mongoose');

const providerSchema = new mongoose.Schema({
    // Auth Fields (Sparse allows null/undefined to be ignored for uniqueness)
    email: { type: String, unique: true, sparse: true }, 
    phone: { type: String, unique: true, sparse: true }, 
    
    password: { type: String, required: true, select: false },
    role: { type: String, default: 'provider', immutable: true },

    // Profile Fields
    name: { type: String, required: true },
    gender: { type: String, enum: ['Male', 'Female', 'Other'], required: true },
    category: { type: String, required: true }, // Example: Nursing, Pharmacy, Lab
    location: { type: String, required: true },
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

module.exports = mongoose.model('Provider', providerSchema);