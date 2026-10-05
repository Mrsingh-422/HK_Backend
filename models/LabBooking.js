const mongoose = require('mongoose');

const labBookingSchema = new mongoose.Schema({
    // ==========================================
    // STEP 1: INITIALIZATION (User starts booking)
    // ==========================================
    bookingId: { type: String, unique: true, required: true }, // Generate: ORD + Timestamp
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    labId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lab', required: true },

    // FLOW: User can book via 2 ways:
    // 1. Direct: Picks tests from list (CBC, Thyroid, etc.)
    // 2. Prescription: Uploads a photo or picks from Doctor's prescription
    bookingType: { 
        type: String, 
        enum: ['Direct', 'Prescription-Based'], 
        default: 'Direct' 
    },
    prescriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Prescription', default: null },
        patients: [{
    patientId: { type: String, required: true }, // 'Self' or family member ID
    name: { type: String, required: true },
    age: { type: Number },
    gender: { type: String },
    relation: { type: String },
    medicalReport: { type: String, default: null },

    // 🚨 NEW: Dynamic, separate collection address for this patient (Figma Screen 3)
    address: {
        name: String,
        phone: String,
        houseNo: String,
        sector: String,
        landmark: String,
        city: String,
        state: String,
        pincode: String,
        addressType: String
    },

    // 🚨 NEW: Specific items assigned to this patient (Figma Screen 2)
    assignedItems: [{
        itemId: { type: mongoose.Schema.Types.ObjectId },
        productType: { type: String, enum: ['LabTest', 'LabPackage'] },
        name: { type: String },
        price: { type: Number }
    }]
}],

    items: {
        tests: [{
            testId: { type: mongoose.Schema.Types.ObjectId, ref: 'LabTest' },
            price: Number,
            name: String,
            precaution: { type: String, default: "" }
        }],
        packages: [{
            packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'LabPackage' },
            price: Number,
            name: String,
            precaution: { type: String, default: "" } 
        }]
    },

    collectionType: { type: String, enum: ['Home Collection', 'Visit Lab'], required: true },
    address: {
        name: String,
        phone: String,
        houseNo: String,
        sector: String,
        landmark: String,
        city: String,
        state: String,
        pincode: String,
        addressType: String
    },

    appointmentDate: { type: Date }, 
    appointmentTime: { type: String }, // e.g. "09:00 AM - 10:00 AM"

    billSummary: {
        itemTotal: { type: Number, default: 0 },       // Sum of all tests/packages
        itemDiscount: { type: Number, default: 0 },    // Lab side discount
appliedCoupon: {
            couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' },
            couponName: String,
            discountPercentage: Number,
            maxDiscount: Number,
            minOrderAmount: Number
        },
        couponDiscount: { type: Number, default: 0 },  // Calculated from Coupon Model
        
        // Charges logic:
        // 1. Home Visit: If collectionType === 'Home Collection', use DeliveryCharge.fixedPrice
        // 2. Distance: (User Dist - fixedDistance) * pricePerKM
        // 3. Rapid: If user selects '6 hrs' (Screen 44), add fastDeliveryExtra * patients.length
        homeVisitCharge: { type: Number, default: 0 },
        distanceCharge: { type: Number, default: 0 },
        rapidDeliveryCharge: { type: Number, default: 0 },
        
        totalAmount: { type: Number, default: 0 },      // Final Payable

        cancellationFeeApplied: { type: Number, default: 0 },
        noShowFeeApplied: { type: Number, default: 0 }
    },

    status: { 
        type: String, 
        enum: [
            'Prescription Uploaded', // User just uploaded photo
            'Under Review',          // Lab is checking prescription
            'Tests Added',           // Lab suggested tests (Wait for User confirmation)
            'Pending',               // User confirmed but payment pending (for Online)
            'Confirmed',             // Order ready to process
            'Phlebotomist Assigned', // Lab assigned a Driver/Phlebotomist
            'Sample Collected',      // Driver reached and took blood sample
            'Sample Deposited',
            'Testing',               // Sample reached lab and in-process
            'Report Generated',      // Result ready
            'Completed',             // Report uploaded and sent to User
            'Cancelled'
        ],
        default: 'Pending'
    },

    // Link to Driver model where vendorType is 'Lab'
    phlebotomistId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', default: null },
    
    paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Done', 'Failed', 'Refunded','Refund-Initiated'], default: 'Pending' },
    paymentMethod: { type: String, enum: ['UPI','COD', 'Card', 'Netbanking', 'Wallet', 'Online'] },

    // The final output
    reportFile: { type: String, default: null }, // Link to PDF file
    patientReports: [{
        patientId: { type: String, required: true },
        patientName: { type: String },
        reportFile: { type: String, required: true }
    }],
    testResults: { type: mongoose.Schema.Types.Mixed, default: {} },
    cancelReason: { type: String },
      tracking: {
        otp: { type: String, default: null }
    },
        phlebotomistId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', default: null },
        rejectedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Driver' }],
        // 🌟 Figma Screen 12 (Lab Deposit details)
    labDepositName: { type: String, default: null },

    // 🌟 Figma Screen 21 (No Show logs)
    noShowComments: { type: String, default: null },

    // Trip tracking timestamps
    startedAt: { type: Date, default: null },
    arrivedAt: { type: Date, default: null },
    collectedAt: { type: Date, default: null },
    depositedAt: { type: Date, default: null },

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

module.exports = mongoose.model('LabBooking', labBookingSchema);