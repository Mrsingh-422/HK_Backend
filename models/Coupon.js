const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
    vendorId: { type: mongoose.Schema.Types.ObjectId, refPath: 'vendorType', default: null },
    vendorType: { type: String, enum: ['Lab', 'Pharmacy', 'Nurse', 'Admin'], default: 'Admin' },
    
    couponName: { type: String, required: true, uppercase: true },
    discountPercentage: { type: Number, required: true },
    maxDiscount: { type: Number, required: true },
    
    // --- New Production Fields ---
    minOrderAmount: { type: Number, default: 0 },    // Min order limit
    maxUsagePerUser: { type: Number, default: 1 },  // Ek user kitni baar use karega
    startDate: { type: Date, default: Date.now },
    expiryDate: { type: Date, required: true },
    
    // Usage Tracking
    usedBy: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        usageCount: { type: Number, default: 1 }
    }],
    
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Coupon', couponSchema);