const mongoose = require('mongoose');

const nurseServiceSchema = new mongoose.Schema({
    nurseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nurse', required: true },
    type: { type: String, enum: ['Daily Care', 'Package'], required: true },
    title: { type: String, required: true }, 
    description: String,
    price: { type: Number, required: true }, // Actual Price
    
    // Figma Screen 42 & 43 fields
    consumablesUsed: [{ type: String }], // Array of strings (e.g., ["Injection", "Needles"])
    procedureIncluded: String,           // e.g., "Dose verification, site cleaning..."
    servicesOffered: String,             // e.g., "Certified home nursing care"
    
    prescriptionRequired: { type: Boolean, default: false },
    photos: [{ type: String }],
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('NurseService', nurseServiceSchema);