const mongoose = require('mongoose');

const driverNotificationSchema = new mongoose.Schema({
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ambulance', required: true },
    title: { type: String, required: true }, // e.g., "New Emergency Case"
    message: { type: String, required: true }, // e.g., "Prepare OR-1 immediately."
    type: { 
        type: String, 
        enum: ['New Emergency Case', 'Admission Request', 'System Maintenance', 'Discharge Approved', 'Referral Received'],
        required: true 
    },
    isRead: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('DriverNotification', driverNotificationSchema);