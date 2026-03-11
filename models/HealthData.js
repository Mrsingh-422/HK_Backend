// models/HealthData.js
const mongoose = require('mongoose');

const healthDataSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['Heart rate', 'Blood Pressure', 'Weight', 'Sugar'], required: true },
    value: { type: String, required: true }, // e.g., "72 bpm" or "120/80"
    note: String,
    date: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('HealthData', healthDataSchema);