const mongoose = require('mongoose');

const healthDataSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { 
        type: String, 
        enum: ['Heart rate', 'Blood Pressure', 'Weight', 'Sugar', 'Steps', 'Calories'], 
        required: true 
    },
    value: { type: String, required: true }, // display value: "120/80" or "72"
    numericValue: { type: Number }, // calculation ke liye: 72 (BP ke liye diastolic use kar sakte hain)
    unit: { type: String }, // bpm, mmHg, kg, steps, kcal
    note: String,
    date: { type: Date, default: Date.now }
}, { timestamps: true });

// Indexing for faster graph queries
healthDataSchema.index({ userId: 1, type: 1, date: -1 });

module.exports = mongoose.model('HealthData', healthDataSchema);