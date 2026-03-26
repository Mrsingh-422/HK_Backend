const mongoose = require('mongoose');

const labPackageSchema = new mongoose.Schema({
    labId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lab', required: true },
    masterPackageId: { type: mongoose.Schema.Types.ObjectId, ref: 'MasterLabPackage', default: null },
    isCustom: { type: Boolean, default: false }, // true agar lab ne khud tests combine karke banaya hai

    packageName: { type: String, required: true },
    tests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MasterLabTest' }], // Link to MasterTests
    
    totalTestsIncluded: { type: Number },
    sampleType: [String], 
    
    // Overridable content (Initially picked from Master)
    description: { type: String },
    precaution: { type: String },
    reportTime: { type: String },
    
    // Pricing (Mandatory for Lab)
    mrp: { type: Number, required: true }, 
    discountPercent: { type: Number, default: 0 },
    offerPrice: { type: Number }, 

    // Filters
    gender: { type: String, enum: ['Male', 'Female', 'Both'], default: 'Both' },
    ageGroup: { type: String },
    
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('LabPackage', labPackageSchema);