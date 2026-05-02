const mongoose = require('mongoose');

const fireNotificationSchema = new mongoose.Schema({
    hqId: { type: mongoose.Schema.Types.ObjectId, ref: 'FireHQ', required: true },
    title: { type: String, required: true }, // e.g., "New Emergency Case"
    message: { type: String }, // e.g., "Severe trauma patient arriving..."
    type: { 
        type: String, 
        enum: ['Emergency', 'Maintenance', 'System', 'Alert'], 
        default: 'System' 
    },
    isRead: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('FireNotification', fireNotificationSchema);