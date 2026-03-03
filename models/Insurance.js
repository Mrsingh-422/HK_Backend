const mongoose = require('mongoose');

const insuranceSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true, 
        unique: true,
        trim: true 
    }, 
    // Example values: 'RGHS', 'CGHS', 'General / Paid'

    isActive: { 
        type: Boolean, 
        default: true 
    }
}, { timestamps: true });

module.exports = mongoose.model('Insurance', insuranceSchema);