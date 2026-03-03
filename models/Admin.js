const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true, select: false },
    phone: { type: String },
    
    role: { 
        type: String, 
        enum: ['superadmin', 'subadmin'], 
        default: 'subadmin' 
    },

    // PHP Flow के हिसाब से Role Assign करना
    roleType: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Role', 
        default: null 
    },

    // Location specific permissions (Separate Key)
    locationAccess: {
        country: { type: String, default: null }, // e.g., "India"
        state: { type: String, default: null },   // e.g., "Rajasthan"
        city: { type: String, default: null }     // e.g., "Jaipur"
    },
    
    token: { 
        type: String, 
        default: null 
    }, 

    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Admin', adminSchema);