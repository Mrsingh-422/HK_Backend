const mongoose = require('mongoose');

const deliveryChargeSchema = new mongoose.Schema({
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true },
    fixedPrice: { type: Number, default: 0 },       // Before 5 KM (Figma: ₹200)
    fixedDistance: { type: Number, default: 5 },    // (Figma: 5 KM)
    pricePerKM: { type: Number, default: 0 },       // Above 5 KM (Figma: ₹10)
    fastDeliveryExtra: { type: Number, default: 0 } // Figma: ₹29
}, { timestamps: true });

module.exports = mongoose.model('DeliveryCharge', deliveryChargeSchema);