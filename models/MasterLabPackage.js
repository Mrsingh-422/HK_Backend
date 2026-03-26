// models/MasterLabPackage.js
const mongoose = require('mongoose');

const masterPackageSchema = new mongoose.Schema({
    packageName: { type: String, required: true, unique: true }, 
    shortDescription: String, 
    longDescription: String, 
    mainCategory: { type: String, enum: ['Radiology', 'Pathology'], default: 'Pathology' },
    category: { type: String }, // e.g. "Full Body", "Diabetes"

    // Technical Details
    tests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MasterLabTest' }], 
    sampleTypes: [String], // e.g. ["Blood", "Urine"]
    reportTime: { type: String, default: "24 Hours" },
    
    // Requirements
    isFastingRequired: { type: Boolean, default: false },
    fastingDuration: { type: String }, 
    preparations: [String], 
    
    // Content
    detailedDescription: [{ sectionTitle: String, sectionContent: String }],
    faqs: [{ question: String, answer: String }],

    // Marketing & Filters
    gender: { type: String, enum: ['Male', 'Female', 'Both'], default: 'Both' },
    ageGroup: { type: String, default: 'All' },
    tags: [String], 
    lifestyleTags: [String],
    packageImage: { type: String },

    // Pricing
    standardMRP: { type: Number }, // Standard price suggested by Admin
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('MasterLabPackage', masterPackageSchema);