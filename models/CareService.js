// models/CareService.js
const mongoose = require('mongoose');

const careServiceSchema = new mongoose.Schema({
    category: { type: String, required: true, index: true }, // e.g., Home Personal Care
    subCategory: { type: String, required: true, index: true }, // e.g., Check In Visits
    description: String,
    procedureIncluded: String,
    prescriptionStatus: { type: String, enum: ['YES', 'NO'], default: 'NO' },
    servicesOffered: String,
    pricePerHour: Number,
    oneDayOneTimePrice: Number,
    discountedPrice: Number,
    careList: [String], // Array if multiple items are separated by ||
    consumablesUsed: String,
    categoryUrl: String
}, { timestamps: true });

module.exports = mongoose.model('CareService', careServiceSchema); 