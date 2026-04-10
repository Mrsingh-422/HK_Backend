// models/NurseService.js (Figma: Daily Care & Packages)
const mongoose = require('mongoose');
const nurseServiceSchema = new mongoose.Schema({
    nurseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nurse', required: true },
    type: { type: String, enum: ['Daily Care', 'Package'], required: true },
    title: { type: String, required: true }, // e.g., "Cancer Care", "ICU Care"
    description: String,
    price: Number,
    consumablesUsed: [String], // e.g., ["Syringe", "Gloves"]
    prescriptionRequired: { type: Boolean, default: false },
    photos: [String]
});
module.exports = mongoose.model('NurseService', nurseServiceSchema);