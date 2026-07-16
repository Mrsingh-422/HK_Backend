const mongoose = require('mongoose');

const noShowConfigSchema = new mongoose.Schema({
    vendorType: {
        type: String,
        enum: ['Lab', 'Pharmacy', 'Nurse', 'Hospital', 'Doctor', 'Ambulance'],
        required: true,
        unique: true
    },
    chargeType: {
        type: String,
        enum: ['Percentage', 'Rupees'],
        default: 'Percentage'
    },
    chargeValue: {
        type: Number,
        default: 0 // Admin can set this to 0 (Free)
    },
    timePeriodInMinutes: {
        type: Number,
        default: null // e.g., 50 minutes (Figma: No-Show time window)
    },
    triggerState: {
        type: String,
        default: null // e.g., 'Driver_Assigned', 'Confirmed'
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('NoShowConfig', noShowConfigSchema);