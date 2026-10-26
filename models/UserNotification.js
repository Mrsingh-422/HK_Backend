// models/UserNotification.js
const mongoose = require('mongoose');

const userNotificationSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true 
    },
    title: { 
        type: String, 
        required: true 
    },
    message: { 
        type: String, 
        required: true 
    },
    type: { 
        type: String, 
        default: 'PRESCRIPTION_BILL_GENERATED' 
    },
    serviceType: { 
        type: String, 
        enum: ['Pharmacy', 'Lab', 'Nurse', 'Doctor', 'Hospital', 'Ambulance', 'General'],
        default: 'General'
    },
    data: { 
        type: mongoose.Schema.Types.Mixed, 
        default: {} 
    },
    isRead: { 
        type: Boolean, 
        default: false,
        index: true 
    }
}, { timestamps: true });

userNotificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('UserNotification', userNotificationSchema);