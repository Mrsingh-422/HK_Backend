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
    },
    // 🚨 ADMIN MANAGED RETURN & REPLACEMENT TERMS & CONDITIONS
    termsAndConditions: {
        type: String,
        default: "1. Return/Replacement requests must be placed within the stipulated return window.\n2. Products must be returned in their original packaging with all accessories, user manuals, and barcodes intact.\n3. Ingestible prescription medicines are strictly non-returnable as per Drug Safety Regulations.\n4. Refunds will be processed once the returned package is physically verified at the pharmacy store counter."
    }

}, { timestamps: true });

module.exports = mongoose.model('PharmacyReturnConfig', pharmacyReturnConfigSchema);