const mongoose = require('mongoose');

const pillReminderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    medicineName: { type: String, required: true },
    dosage: { type: String }, // e.g., "500mg - 1 tablet"
    
    // Schedule Logic
    frequency: { type: String, enum: ['Daily', 'Weekly', 'Custom'], default: 'Daily' },
    daysOfWeek: [Number], // [0, 1, 2] - Sunday, Monday, Tuesday (if Weekly/Custom)
    times: [{
        time: String, // "09:00 AM"
        isTakenToday: { type: Boolean, default: false } // Reset daily via cron or logic
    }],
    
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date }, // Optional: If medicine is for limited days
    
    isReminderOn: { type: Boolean, default: true },
    status: { type: String, enum: ['Active', 'Completed'], default: 'Active' },
    notes: { type: String },

    // History Tracking (Production Level)
    history: [{
        date: Date,
        time: String,
        action: { type: String, enum: ['Taken', 'Skipped', 'Snoozed'] }
    }]
}, { timestamps: true });

module.exports = mongoose.model('PillReminder', pillReminderSchema);