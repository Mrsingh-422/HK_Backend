// models/CareService.js
const mongoose = require('mongoose');

const careServiceSchema = new mongoose.Schema({
    category: { type: String, required: true, index: true },
    subCategory: { type: String, required: true, index: true },
    description: String,
    procedureIncluded: String,
    prescriptionStatus: { type: String, enum: ['YES', 'NO'], default: 'NO' },
    servicesOffered: String,
    pricePerHour: { type: Number, default: 0 },
    oneDayOneTimePrice: { type: Number, default: 0 },
    forMultipleDaysPrice: { type: Number, default: 0 }, // New Key from Excel
    careList: [String],
    consumablesUsed: String, // String format: "Item [Size] || Item [Size]"
    categoryUrl: String,
    noCare: String // Mapping "no_Care" from Excel
}, { timestamps: true });

module.exports = mongoose.model('CareService', careServiceSchema);