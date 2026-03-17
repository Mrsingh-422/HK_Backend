// const mongoose = require('mongoose');

// const providerSchema = new mongoose.Schema({
//     name: { type: String, required: true },
//     email: { type: String, unique: true, sparse: true, lowercase: true }, 
//     phone: { type: String, unique: true, sparse: true }, 
//     password: { type: String, required: true, select: false },
//     role: { type: String, default: 'provider', immutable: true },

//     // Location Fields (Structured for search/filter)
//     country: { type: String, default: null },
//     state: { type: String, default: null },
//     city: { type: String, default: null },
//     address: { type: String, default: null },

//     gender: { type: String, enum: ['Male', 'Female', 'Other'], default: 'Male' },
//     category: { type: String, required: true }, // Nursing, Pharmacy, Lab
    
//     profileImage: { type: String, default: null },
//     documents: [{ type: String }], // License, Certificates etc.

//     token: { type: String, default: null },

//     // Status Flow
//     profileStatus: { 
//         type: String, 
//         enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'], 
//         default: 'Incomplete' 
//     },
//     rejectionReason: { type: String, default: null }
// }, { timestamps: true });

// module.exports = mongoose.model('Provider', providerSchema);