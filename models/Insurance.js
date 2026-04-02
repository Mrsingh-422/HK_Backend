const mongoose = require('mongoose');

const insuranceSchema = new mongoose.Schema({
    // 1. Provider Name (e.g., HDFC)
    provider: {
        type: String,
        required: [true, 'Provider name is required'],
        trim: true
    },
    // 2. Specific Insurance Name (e.g., HDFC ERGO)
    insuranceName: { 
        type: String, 
        required: true, 
        unique: true, // Naya index 'insuranceName_1' banega
        trim: true 
    },

    type: { 
        type: String, 
        required: true ,
        lowercase: true,
        trim: true 
    },
    isActive: { 
        type: Boolean, 
        default: true 
    }
}, { timestamps: true });

module.exports = mongoose.model('Insurance', insuranceSchema);