// models/Availability.js
const mongoose = require('mongoose');
const availabilitySchema = new mongoose.Schema({
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true },
    morningSlots: { type: Boolean, default: false },
    afternoonSlots: { type: Boolean, default: false },
    eveningSlots: { type: Boolean, default: false },
    startTime: String, // "09:00"
    endTime: String,   // "18:00"
    slotDuration: { type: Number, default: 30 }, // in minutes
    offDays: [String]  // ["Sunday"]
}, { timestamps: true });
module.exports = mongoose.model('Availability', availabilitySchema);