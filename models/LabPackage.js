// models/LabPackage.js (Group of Tests)
const mongoose = require('mongoose');

const labPackageSchema = new mongoose.Schema({
    labId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lab', required: true }, // Ref: Lab
    packageName: { type: String, required: true },
    tests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'LabTest' }],
    totalTestsIncluded: Number,
    
    mrp: Number,
    offerPrice: Number,
    discountPercent: String,
    
    reportTime: String,
    description: String,
    gender: { type: String, enum: ['Male', 'Female', 'Both'], default: 'Both' },
    ageGroup: { type: String } 
}, { timestamps: true });

module.exports = mongoose.model('LabPackage', labPackageSchema); 