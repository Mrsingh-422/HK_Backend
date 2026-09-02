const mongoose = require('mongoose');

const cancellationConfigSchema = new mongoose.Schema({
    vendorType: {
    type: String,
    enum: [
        'Lab', 'Pharmacy', 'Nurse', 'Hospital', 'Doctor', 'Ambulance',
        'Ambulance-Medical', 'Ambulance-Referral' // 👈 Specific ambulance policies added
    ],
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
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('CancellationConfig', cancellationConfigSchema);