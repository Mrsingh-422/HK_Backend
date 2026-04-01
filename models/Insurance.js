const mongoose = require('mongoose');

const insuranceSchema = new mongoose.Schema({
    insuranceName: { 
        type: String, 
        required: true, 
        unique: true, // Naya index 'insuranceName_1' banega
        trim: true 
    },
    type: { 
        type: String, 
        required: true 
    },
    isActive: { 
        type: Boolean, 
        default: true 
    }
}, { timestamps: true });

module.exports = mongoose.model('Insurance', insuranceSchema);