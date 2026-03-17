// models/LabTest.js (Figma: Add New Tests)
const mongoose = require('mongoose');
const labTestSchema = new mongoose.Schema({
    labId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider' },
    category: String,
    testName: String,
    sampleType: String, // Blood, Urine, etc.
    photos: [String],
    description: String,
    safetyAdvice: String,
    precaution: String,
    sicknessType: String,
    testType: { type: String, enum: ['Home Collection', 'Walk-In'] },
    amount: Number,
    discountPrice: Number
});
module.exports = mongoose.model('LabTest', labTestSchema);