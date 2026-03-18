// models/LabTest.js (Figma: Add New Tests)
const mongoose = require('mongoose');

const labTestSchema = new mongoose.Schema({
    labId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lab' },
    // Master Test se link
    masterTestId: { type: mongoose.Schema.Types.ObjectId, ref: 'MasterLabTest', required: true },
    
    // Inhe hum master list se copy kar sakte hain ya ref se populate
    mainCategory: { type: String, enum: ['Radiology', 'Pathology'] }, 
    testName: { type: String },
    sampleType: { type: String },
    
    // Vendor specific data (Figma fields)
    photos: [String],
    description: { type: String },
    safetyAdvice: { type: String },
    precaution: { type: String },
    sicknessType: { type: String }, // Figma: Which test for Sickness
    testType: { type: String, enum: ['Home Collection', 'Walk-In', 'Both'] },
    amount: { type: Number, required: true },
    discountPrice: { type: Number, default: 0 },
    discountPercent: { type: String }, // Calculated field
}, { timestamps: true });

module.exports = mongoose.model('LabTest', labTestSchema);