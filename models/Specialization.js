const mongoose = require('mongoose');

const specializationSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true, 
        unique: true, 
        trim: true 
    }, // e.g. "Cardiologist", "Dentist"
    
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Specialization', specializationSchema);