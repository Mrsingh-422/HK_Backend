const mongoose = require('mongoose');

const qualificationSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true, 
        unique: true, 
        trim: true 
    }, // e.g. "MBBS", "MD", "BAMS"

    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Qualification', qualificationSchema);