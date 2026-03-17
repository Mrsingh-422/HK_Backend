// models/LabPackage.js (Group of Tests)
const mongoose = require('mongoose');
const labPackageSchema = new mongoose.Schema({
    packageName: String, // e.g., Full Body Checkup
    labId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lab' },
    tests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'LabTest' }], // Custom Selection
    totalTestsIncluded: Number,
    mrp: Number,
    offerPrice: Number,
    discountPercent: String,
    reportTime: String,
    description: String, // What's included
    gender: { type: String, enum: ['Male', 'Woman', 'Both'], default: 'Both' },
    ageGroup: { type: String } // e.g., "Below 30", "Above 55"
});

module.exports = mongoose.model('LabPackage', labPackageSchema);