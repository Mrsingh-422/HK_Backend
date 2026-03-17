// models/Coupon.js
const mongoose = require('mongoose');
const couponSchema = new mongoose.Schema({
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true },
    vendorType: { type: String, enum: ['Lab', 'Pharmacy', 'Doctor'], required: true },
    couponName: { type: String, required: true, uppercase: true },
    discountPercentage: { type: Number, required: true },
    maxDiscount: { type: Number, required: true },
    expiryDate: { type: Date, required: true },
    startDate: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });
module.exports = mongoose.model('Coupon', couponSchema);