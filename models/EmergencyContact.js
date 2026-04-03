const mongoose = require('mongoose');

const emergencyContactSchema = new mongoose.Schema({
    title: { 
        type: String, 
        required: true, 
        uppercase: true 
    },
    contactOne: { 
        type: String, 
        required: true 
    },
    contactTwo: { 
        type: String 
    },
    email: { 
        type: String, 
        required: true 
    },
    createdBy: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User' 
    }
}, { timestamps: true });

module.exports = mongoose.model('EmergencyContact', emergencyContactSchema);