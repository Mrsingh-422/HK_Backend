// models/LabTest.js (Figma: Add New Tests)
const mongoose = require('mongoose');

const labTestSchema = new mongoose.Schema({
    labId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lab' },
    mainCategory: { type: String, enum: ['Radiology', 'Pathology'], required: true }, 
    category: String, // e.g., "Full Body", "Diabetes"
    testName: { type: String, required: true },
    sampleType: String, 
    photos: [String],
    description: String,
    safetyAdvice: String,
    precaution: String,
    sicknessType: String,
    testType: { type: String, enum: ['Home Collection', 'Walk-In'] },
    amount: { type: Number, required: true },
    discountPrice: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('LabTest', labTestSchema);