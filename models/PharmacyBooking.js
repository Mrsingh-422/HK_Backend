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
        name: String,        // Delivery Recipient Name
        phone: String,       // Contact Number
        houseNo: String,
        sector: String,
        landmark: String,
        city: String,
        state: String,
        country: String,
        pincode: String,
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
    
    orderType: { type: String, enum: ['General', 'Prescription'], default: 'General' },
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', default: null },
    
    // Delivery Tracking Statuses
    deliveryStatus: { 
        type: String, 
        enum: ['PendingAssignment', 'Assigned', 'Accepted', 'PickedUp', 'OutForDelivery', 'ReachedLocation', 'Delivered', 'CancelledByDriver', 'UserUnreachable', 'UserRefused'], 
        default: 'PendingAssignment' 
    },
    
    deliveryOTP: { type: String }, // For final verification
    assignedAt: { type: Date },
    rejectedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Driver' }], // To avoid re-assigning to same driver
    
    // For Prescription orders
    prescriptionImages: [String],
    status: { 
        type: String, 
        enum: ['Placed', 'Under Review', 'Packed', 'Shipped', 'Delivered', 'Cancelled'], 
        default: 'Placed' 
    },

    cancelReason: { type: String },
    prescriptionFile: { type: String }, // For prescription-based orders
    
}, { timestamps: true });


module.exports = mongoose.model('PharmacyBooking', pharmacyBookingSchema);