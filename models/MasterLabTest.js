const mongoose = require('mongoose');

const masterLabTestSchema = new mongoose.Schema({
    testName: { type: String, required: true, unique: true },
    mainCategory: { type: String, enum: ['Radiology', 'Pathology'], required: true },
    category: { type: String }, // e.g. "Diabetes", "Fever"
    sampleType: { type: String }, // e.g. "Blood", "Urine", "NA" (Radiology ke liye NA)
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('MasterLabTest', masterLabTestSchema); 