const mongoose = require('mongoose');

const fireLeaveSchema = new mongoose.Schema({
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'FireStaff', required: true },
    stationId: { type: mongoose.Schema.Types.ObjectId, ref: 'FireStation', required: true },
    leaveType: { type: String, enum: ['Sick', 'Casual', 'Earned', 'Emergency'], required: true },
    fromDate: Date,
    toDate: Date,
    duration: Number,
    reason: String,
    attachment: String, // Medical Certificate (Screen 4)
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    shiftImpact: String // Screen 3: "Night duty shortage"
}, { timestamps: true });

module.exports = mongoose.model('FireLeave', fireLeaveSchema);