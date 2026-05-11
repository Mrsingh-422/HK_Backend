const mongoose = require('mongoose');

const menstrualTrackerSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lastPeriodDate: { type: Date, required: true },
    cycleLength: { type: Number, default: 28 }, // Avg cycle days
    periodDuration: { type: Number, default: 5 }, // Kitne din period rehta hai
    
    // Tracking historical data
    periods: [{
        startDate: Date,
        endDate: Date,
        flowIntensity: { type: String, enum: ['Light', 'Medium', 'Heavy'], default: 'Medium' }
    }],
    
    notes: String
}, { timestamps: true });

module.exports = mongoose.model('MenstrualTracker', menstrualTrackerSchema);