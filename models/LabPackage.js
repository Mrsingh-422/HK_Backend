// models/LabPackage.js (Fully Aligned & Synchronized)
const mongoose = require('mongoose');

const labPackageSchema = new mongoose.Schema({
    // --- VENDOR-SPECIFIC OPERATIONAL KEYS (DO NOT MISS) ---
    labId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lab', required: true },
    masterPackageId: { type: mongoose.Schema.Types.ObjectId, ref: 'MasterLabPackage', default: null },
    isCustom: { type: Boolean, default: false }, // true agar lab ne khud tests combine karke banaya hai

    packageName: { type: String, required: true },
    tests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MasterLabTest' }], // Link to MasterTests
    totalTestsIncluded: { type: Number },

    // 🚨 BACKWARD COMPATIBILITY KEYS (Kept safe for older cart/checkout/user modules) [cite: labPackageSchema]
    sampleType: [String], 
    precaution: { type: String }, 
    description: { type: String },

    // 🚨 STRICT MASTER LAB PACKAGE SCHEMAS ALIGNED KEYS [cite: masterPackageSchema]
    shortDescription: { type: String, default: "" },
    longDescription: { type: String, default: "" },
    mainCategory: { type: String, default: 'Pathology' },
    category: { type: String }, 
    sampleTypes: [String], 
    reportTime: { type: String, default: "24 Hours" },
    isFastingRequired: { type: Boolean, default: false },
    fastingDuration: { type: String }, 
    preparations: [String], 
    detailedDescription: [{ sectionTitle: String, sectionContent: String }],
    faqs: [{ question: String, answer: String }],
    gender: { type: String, enum: ['Male', 'Female', 'Both'], default: 'Both' },
    ageGroup: { type: String, default: 'All' },
    tags: [String], 
    lifestyleTags: [String],
    packageImage: { type: String },

    // Pricing (Mandatory for Lab)
    mrp: { type: Number, required: true }, 
    discountPercent: { type: Number, default: 0 },
    offerPrice: { type: Number }, 
    
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('LabPackage', labPackageSchema);