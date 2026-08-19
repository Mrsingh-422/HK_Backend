// models/HsnMaster.js
const mongoose = require('mongoose');

const hsnMasterSchema = new mongoose.Schema({
    hsnCode: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true
    },
    description: {
        type: String,
        required: true,
        trim: true
    },
    totalGstPercent: {
        type: Number,
        required: true,
        default: 12 // e.g., 12 means 12% total GST (6% CGST + 6% SGST)
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('HsnMaster', hsnMasterSchema);