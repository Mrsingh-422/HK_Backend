// models/Ward.js
const mongoose = require('mongoose');
const wardSchema = new mongoose.Schema({
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' },
    name: { type: String, required: true }, // Surgical Ward, Neuro ICU
    type: { type: String, enum: ['ICU', 'Ward'], required: true },
    totalBeds: { type: Number, required: true },
    availableBeds: { type: Number, required: true },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });
module.exports = mongoose.model('Ward', wardSchema);