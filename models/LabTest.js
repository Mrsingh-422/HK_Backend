// models/LabTest.js (Figma: Add New Tests)
const mongoose = require('mongoose');

const labTestSchema = new mongoose.Schema({
    labId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lab', required: true }, // Ref: Lab
    masterTestId: { type: mongoose.Schema.Types.ObjectId, ref: 'MasterLabTest', required: true },
    
    mainCategory: { type: String, enum: ['Radiology', 'Pathology'] }, 
    testName: { type: String },
    sampleType: { type: String },
    
    photos: [String],
    description: { type: String },
    safetyAdvice: { type: String },
    precaution: { type: String },
    sicknessType: { type: String },
    testType: { type: String, enum: ['Home Collection', 'Walk-In', 'Both'] },
    
    amount: { type: Number, required: true }, // MRP
    discountPrice: { type: Number },          // Calculated Actual Price
    discountPercent: { type: String }         // "15%"
}, { timestamps: true });

module.exports = mongoose.model('LabTest', labTestSchema);