// models/AdminCommissionConfig.js
const mongoose = require('mongoose');

const adminCommissionConfigSchema = new mongoose.Schema({
    vendorType: {
        type: String,
        enum: [
            'Doctor', 
            'Hospital', 
            'Lab', 
            'Pharmacy', 
            'Nurse', 
            'Ambulance-Accident', 
            'Ambulance-Medical', 
            'Ambulance-Referral'
        ],
        required: true,
        unique: true
    },
    commissionType: {
        type: String,
        enum: ['Percentage', 'Rupees', 'Both', 'None'],
        default: 'Percentage'
    },
    percentageValue: {
        type: Number,
        default: 10 // e.g. 10%
    },
    fixedRupeesValue: {
        type: Number,
        default: 0 // e.g. ₹50 per order
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('AdminCommissionConfig', adminCommissionConfigSchema);