const mongoose = require('mongoose');

const pillReminderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    medicineName: { type: String, required: true },
    dosage: { type: String }, 
    frequency: { type: String, enum: ['Daily', 'Weekly', 'Custom'], default: 'Daily' },
    daysOfWeek: [Number], 
    times: [{
        time: String, // "09:00 AM"
        isTakenToday: { type: Boolean, default: false },
        snoozeUntil: { type: Date, default: null } // 👈 Snooze handle karne ke liye
    }],
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date }, 
    isReminderOn: { type: Boolean, default: true },
    status: { type: String, enum: ['Active', 'Completed'], default: 'Active' },
    notes: { type: String },

    history: [{
        date: { type: String }, // Format: "YYYY-MM-DD" comparison ke liye asaan hai
        time: String,
        action: { type: String, enum: ['Taken', 'Skipped', 'Snoozed'] }
    }]
}, { timestamps: true });

module.exports = mongoose.model('PillReminder', pillReminderSchema);