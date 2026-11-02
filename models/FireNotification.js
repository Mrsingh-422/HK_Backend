const mongoose = require('mongoose');

const fireNotificationSchema = new mongoose.Schema({
    hqId: { type: mongoose.Schema.Types.ObjectId, ref: 'FireHQ', default: null },
    stationId: { type: mongoose.Schema.Types.ObjectId, ref: 'FireStation', default: null },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'FireStaff', default: null },
    global: { type: Boolean, default: false },
    title: { type: String, required: true },
    message: { type: String },
    type: { 
        type: String, 
        enum: ['Emergency', 'Maintenance', 'System', 'Alert'], 
        default: 'System' 
    },
    isRead: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('FireNotification', fireNotificationSchema);    