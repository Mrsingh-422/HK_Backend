// models/PharmacyBooking.js
const mongoose = require('mongoose');

const pharmacyBookingSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pharmacy', required: true },
    
    // Order Items (Cart se copy honge)
    items: [{
        medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine' },
        name: String,
        price: Number,
        quantity: Number,
        duration: String, // "5 Days"
        startDate: Date
    }],

    // Delivery & Payment
    deliveryAddress: Object,
    billSummary: {
        itemTotal: Number,
        deliveryCharge: Number,
        tax: Number,
        totalAmount: Number
    },
    paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Failed', 'Refunded'], default: 'Pending' },
    
    // Figma Status Timeline
    status: { 
        type: String, 
        enum: ['Placed', 'Packed', 'Shipped', 'Delivered', 'Cancelled'], 
        default: 'Placed' 
    },
    prescriptionFile: { type: String }, // User ne jo upload kiya tha
    orderId: { type: String, unique: true }
}, { timestamps: true });

module.exports = mongoose.model('PharmacyBooking', pharmacyBookingSchema);