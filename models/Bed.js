const mongoose = require('mongoose');

const bedSchema = new mongoose.Schema({
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
    wardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ward', required: true }, // 👈 Ward se link kiya
    bedNumber: { type: String, required: true }, // e.g., "Bed 04"
    status: { 
        type: String, 
        enum: ['Available', 'Occupied', 'Reserved', 'Maintenance'], 
        default: 'Available' 
    },
    pricePerDay: { type: Number, required: true },
    isVentilatorAvailable: { type: Boolean, default: false } // Figma Screenshot 27 bottom
}, { timestamps: true });

module.exports = mongoose.model('Bed', bedSchema);