// models/PharmacyReturnConfig.js
const mongoose = require('mongoose');

const pharmacyReturnConfigSchema = new mongoose.Schema({
    vendorType: {
        type: String,
        default: 'Pharmacy',
        unique: true
    },
    returnWindowDays: {
        type: Number,
        default: 3, // 👈 Default 3 din deliver hone ke baad tak return allowed
        required: true
    },
    isReturnEnabled: {
        type: Boolean,
        default: true
    },
    isReplacementEnabled: {
        type: Boolean,
        default: true
    },
    allowedReasons: {
        type: [String],
        default: [
            "Damaged or Leaked Medicine",
            "Expired Product Delivered",
            "Wrong Item Delivered",
            "Seal Broken / Opened Packaging"
        ]
    }
}, { timestamps: true });

module.exports = mongoose.model('PharmacyReturnConfig', pharmacyReturnConfigSchema);