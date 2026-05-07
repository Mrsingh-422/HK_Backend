const mongoose = require('mongoose');
 
const leaveRequestSchema = new mongoose.Schema({
    stationId: { type: mongoose.Schema.Types.ObjectId, ref: 'PoliceStation', required: true },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'PoliceStaff', required: true },
    leaveType: { type: String, enum: ['Sick Leave', 'Casual Leave (CL)', 'Earned Leave (EL)', 'Emergency Leave', 'Duty Leave', 'Paternity Leave'], required: true },
    duration: { type: String, required: true }, // e.g., "3 Days"
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    reason: { type: String, required: true },
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    rejectionReason: { type: String } // For Screen 8
}, { timestamps: true });
 
module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);