const mongoose = require('mongoose');

const labCategorySchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true }, // e.g. "Hormonal", "Cancer"
    image: { type: String, default: null },
    vendorType: { type: String, enum: ['Lab', 'Pharmacy'], default: 'Lab' }
}, { timestamps: true });

module.exports = mongoose.model('LabCategory', labCategorySchema);