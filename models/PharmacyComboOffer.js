// models/PharmacyComboOffer.js (Updated with images array)
const mongoose = require('mongoose');

const pharmacyComboOfferSchema = new mongoose.Schema({
    pharmacyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Pharmacy',
        required: true,
        index: true
    },
    campaignDisplayName: {
        type: String,
        required: true,
        trim: true
    },
    medicineId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Medicine',
        required: true
    },
    // Added multiple images array support
    images: [{
        type: String
    }],
    buyQty: {
        type: Number,
        required: true,
        default: 2
    },
    getFreeQty: {
        type: Number,
        required: true,
        default: 1
    },
    startDate: {
        type: Date,
        required: true
    },
    expiryDate: {
        type: Date,
        required: true
    },
    projectedPromoMargin: {
        type: Number,
        default: 50.0
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

pharmacyComboOfferSchema.index({ pharmacyId: 1, medicineId: 1 }, { unique: true });

module.exports = mongoose.model('PharmacyComboOffer', pharmacyComboOfferSchema);