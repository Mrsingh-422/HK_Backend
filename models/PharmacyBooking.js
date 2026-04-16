// models/PharmacyBooking.js
const mongoose = require('mongoose');

const pharmacyBookingSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pharmacy', required: true },
    orderId: { type: String, unique: true, required: true },

    // --- PATIENTS SECTION (Multiple patients support) ---
    patients: [{
        patientId: { type: String }, // 'Self' or family member ID
        name: String,
        age: Number,
        gender: { type: String, enum: ['Male', 'Female', 'Other'] },
        relation: String
    }],

    // --- ORDER ITEMS (Medicine Details) ---
    items: [{
        medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine' },
        name: String,
        price: Number,
        quantity: { type: Number, default: 1 },
        duration: String, // e.g., "5 Days"
        startDate: Date
    }],

    // --- LOGISTICS & SLOTS ---
    collectionType: { 
        type: String, 
        enum: ['Home Delivery', 'Self Pickup'], 
        required: true 
    },
    appointmentDate: { type: Date, required: true },
    appointmentTime: { type: String, required: true }, 
    isRapid: { type: Boolean, default: false }, 

    // --- ADDRESS SECTION ---
    address: {
        houseNo: String,
        city: String,
        pincode: String,
        landmark: String,
        addressType: { type: String, default: 'Home' }
    },

    // --- BILLING SUMMARY ---
    billSummary: {
        itemTotal: { type: Number, required: true },
        deliveryCharge: { type: Number, default: 0 },
        rapidDeliveryCharge: { type: Number, default: 0 },
        slotCharge: { type: Number, default: 0 },
        couponDiscount: { type: Number, default: 0 },
        couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' },
        totalAmount: { type: Number, required: true }
    }, 

    // --- PAYMENT & STATUS ---
    paymentMethod: { type: String, enum: ['COD', 'Online', 'Wallet'], default: 'COD' },
    paymentStatus: { 
        type: String, 
        enum: ['Pending', 'Paid', 'Failed', 'Refunded'], 
        default: 'Pending' 
    },
    
    status: { 
        type: String, 
        enum: ['Placed', 'Packed', 'Shipped', 'Delivered', 'Cancelled', 'Under Review'], 
        default: 'Placed' 
    },

    cancelReason: { type: String },
    prescriptionFile: { type: String }, // For prescription-based orders
    
}, { timestamps: true });


module.exports = mongoose.model('PharmacyBooking', pharmacyBookingSchema);