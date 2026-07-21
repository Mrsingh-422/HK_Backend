const mongoose = require('mongoose');

const codConfigSchema = new mongoose.Schema({
    vendorType: {
        type: String,
        enum: ['Lab', 'Pharmacy', 'Nurse', 'Hospital', 'Doctor', 'Ambulance'],
        required: true,
        unique: true
    },
    isCodAvailable: {
        type: Boolean,
        default: true // Can be toggled true or false by Admin
    }
}, { timestamps: true });

module.exports = mongoose.model('CodConfig', codConfigSchema);