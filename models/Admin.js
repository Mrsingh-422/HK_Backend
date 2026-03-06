const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true, select: false },
    phone: { type: String },
    
    role: { type: String, enum: ['superadmin', 'subadmin'], default: 'subadmin' },
    roleType: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Role', 
        default: null 
    },
    locationAccess: {
        country: { type: String, default: null },
        state: { type: String, default: null },
        city: { type: String, default: null }
    },
    
    token: { 
        type: String, 
        default: null 
    }, 

    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Admin', adminSchema);