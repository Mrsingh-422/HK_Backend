const mongoose = require('mongoose');

const fireAttendanceSchema = new mongoose.Schema({
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'FireStaff', required: true },
    stationId: { type: mongoose.Schema.Types.ObjectId, ref: 'FireStation', required: true },
    checkIn: { type: Date, default: Date.now },
    checkOut: { type: Date },
    shift: { type: String, enum: ['Day', 'Night'] },
    status: { type: String, enum: ['Present', 'On Duty', 'Absent'], default: 'Present' },
    location: { lat: Number, lng: Number } // Check-in location
}, { timestamps: true });

module.exports = mongoose.model('FireAttendance', fireAttendanceSchema);