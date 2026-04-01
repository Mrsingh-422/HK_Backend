const mongoose = require('mongoose');
const insuranceTypeSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });
module.exports = mongoose.model('InsuranceType', insuranceTypeSchema);