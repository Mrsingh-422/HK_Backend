const mongoose = require('mongoose');

const deliveryChargeSchema = new mongoose.Schema({
    // Dynamic Reference: Yeh 'Lab', 'Pharmacy', ya 'Nurse' model se link hoga
    vendorId: { 
        type: mongoose.Schema.Types.ObjectId, 
        required: true, 
        refPath: 'vendorType',
        unique: true 
    },
    vendorType: { 
        type: String, 
        enum: ['Lab', 'Pharmacy', 'Nurse'], 
        required: true 
    },

    // Figma Screen 15 Fields
    fixedPrice: { type: Number, default: 50 },          // Base Delivery Charge
    fixedDistance: { type: Number, default: 5 },        // Free Radius (KM)
    pricePerKM: { type: Number, default: 5 },           // Price per KM (Beyond fixed distance)
    fastDeliveryExtra: { type: Number, default: 100 },  // Rapid Delivery Charge

    // Extra Production Fields
    freeDeliveryThreshold: { type: Number, default: 300 }, 
    taxPercentage: { type: Number, default: 0 },
    taxInRupees: { type: Number, default: 0 }

}, { timestamps: true });

module.exports = mongoose.model('DeliveryCharge', deliveryChargeSchema);