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
        mrp: { type: Number, default: 0 },   // Added MRP storage field here
        price: Number,
        quantity: { type: Number, default: 1 },
        duration: String, // e.g., "5 Days"
        startDate: Date,

         // 🚨 NEW COMBO / BOGO TRACKING FIELDS
        isComboApplied: { type: Boolean, default: false },
        comboOfferId: { type: mongoose.Schema.Types.ObjectId, ref: 'PharmacyComboOffer', default: null },
        freeQuantity: { type: Number, default: 0 }, // Saved units (Y)

        // 🚨 NEW GST KEYS FOR BILL GENERATION
        hsn_number: { type: String, required: true },
        taxableAmount: { type: Number, default: 0 },
        cgstPercent: { type: Number, default: 6 },
        sgstPercent: { type: Number, default: 6 },
        cgstAmount: { type: Number, default: 0 },
        sgstAmount: { type: Number, default: 0 }
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
        originalItemTotal: { type: Number, default: 0 },
        comboSavings: { type: Number, default: 0 },

        // 🚨 ADDED: Global Invoice GST Summaries for final orders
        taxableTotal: { type: Number, default: 0 },
        cgstTotal: { type: Number, default: 0 },
        sgstTotal: { type: Number, default: 0 },

        deliveryCharge: { type: Number, default: 0 },
        rapidDeliveryCharge: { type: Number, default: 0 },
        slotCharge: { type: Number, default: 0 },
        couponDiscount: { type: Number, default: 0 },
        couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' },
        totalAmount: { type: Number, required: true },
        cancellationFeeApplied: { type: Number, default: 0 },
        noShowFeeApplied: { type: Number, default: 0 }
    },

    // --- PAYMENT & STATUS ---
    paymentMethod: { type: String, enum: ['UPI','COD', 'Card', 'Netbanking', 'Wallet', 'Online'], default: 'COD' },
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
        enum: ['Pending','Placed', 'Under Review', 'Packed', 'Shipped', 'Delivered', 'Cancelled'], 
        default: 'Placed' 
    },

    cancelReason: { type: String },
    prescriptionFile: { type: String }, // For prescription-based orders

     // 🌟 Figma Screen 14 (Proof of Delivery Photo)
    deliveryProofPic: { type: String, default: null },

    // 🌟 Figma Screen 13 (Return Details)
    returnReason: { type: String, default: null },

    // Live trip tracking timestamps
    startedAt: { type: Date, default: null },
    arrivedAt: { type: Date, default: null },

    paymentDetails: {
        razorpayPaymentId: { type: String, default: "" },
        razorpayOrderId: { type: String, default: "" },
        razorpaySignature: { type: String, default: "" },
        method: { type: String, default: "" },        // upi, card, netbanking, wallet
        amount: { type: Number, default: 0 },         // Amount in Rupees (converted from paise)
        currency: { type: String, default: "INR" },
        status: { type: String, default: "" },         // captured, failed
        bank: { type: String, default: "" },           // Bank name if netbanking/card
        wallet: { type: String, default: "" },         // Wallet name if wallet
        vpa: { type: String, default: "" },            // UPI VPA if UPI
        cardDetails: {
            last4: String,
            network: String,
            type: String
        },
        paidAt: { type: Date, default: null }
    }

    
}, { timestamps: true });


module.exports = mongoose.model('PharmacyBooking', pharmacyBookingSchema);