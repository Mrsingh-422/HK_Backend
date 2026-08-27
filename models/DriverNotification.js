// models/DriverNotification.js
const mongoose = require('mongoose');

const driverNotificationSchema = new mongoose.Schema({
    driverId: { type: mongoose.Schema.Types.ObjectId, required: true }, // Supports all driver models
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { 
        type: String, 
        enum: [
            'New Task Assigned', 
            'Emergency Case', 
            'Order Reassigned', 
            'Return Pickup Task', 
            'System Alert'
        ],
        default: 'New Task Assigned'
    },
    isRead: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('DriverNotification', driverNotificationSchema);