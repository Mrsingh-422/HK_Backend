// models/HsnRequest.js
const mongoose = require('mongoose');

const hsnRequestSchema = new mongoose.Schema({
    vendorId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Pharmacy', 
        required: true, 
        index: true 
    },
    hsnCode: { 
        type: String, 
        required: true, 
        trim: true 
    },
    description: { 
        type: String, 
        required: true, 
        trim: true 
    },
    suggestedTaxPercent: { 
        type: Number, 
        required: true, 
        default: 12 
    },
    reason: { 
        type: String, 
        default: "New product / novel molecule launched in market." 
    },
    status: { 
        type: String, 
        enum: ['Pending', 'Approved', 'Rejected'], 
        default: 'Pending',
        index: true
    },
    rejectionReason: { 
        type: String, 
        default: null 
    }
}, { timestamps: true });

module.exports = mongoose.model('HsnRequest', hsnRequestSchema);