const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: String,
    
    // 👇 Polymorphic References
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'targetType' },
    targetType: { 
        type: String, 
        enum: ['Doctor', 'Lab', 'Pharmacy', 'Nurse', 'Hospital', 'Ambulance', 'Driver'], 
        required: true 
    },
    
    // Booking/Order ID (Reference for order verification)
    orderId: { type: mongoose.Schema.Types.ObjectId, required: true },
    
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Review', reviewSchema);