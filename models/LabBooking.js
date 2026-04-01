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

    // ==========================================
    // STEP 2: PATIENT & ITEM SELECTION (Figma Screen 11-15, 30-36)
    // ==========================================
    // User can select multiple family members or 'Self'
    patients: [{
        patientId: String, // ID from User.familyMember or 'Self'
        name: String,
        age: Number,
        gender: String,
        relation: String,
        medicalReport: String // Optional: User uploads previous report (Screen 16)
    }],

    // FLOW: If Direct Booking, items will be filled now.
    // If Prescription-Based, Lab will fill this after review (Screen 67).
    items: {
        tests: [{
            testId: { type: mongoose.Schema.Types.ObjectId, ref: 'LabTest' },
            price: Number,
            name: String
        }],
        packages: [{
            packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'LabPackage' },
            price: Number,
            name: String
        }]
    },

    // ==========================================
    // STEP 3: LOGISTICS & SLOTS (Figma Screen 21-25, 45-46)
    // ==========================================
    collectionType: { type: String, enum: ['Home Collection', 'Visit Lab'], required: true },
    address: {
        addressType: String, // Home, Office, Other
        pincode: String,
        houseNo: String,
        sector: String,
        city: String,
        state: String,
        lat: Number,
        lng: Number
    },

    // FLOW: Slot selected using 'Availability' model intervals.
    // Note: If collectionType is 'Visit Lab', address is Lab's address.
    appointmentDate: { type: Date }, 
    appointmentTime: { type: String }, // e.g. "09:00 AM - 10:00 AM"

    // ==========================================
    // STEP 4: PRICE CALCULATION (Using DeliveryCharge & Coupon Models)
    // ==========================================
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
        
        totalAmount: { type: Number, default: 0 }      // Final Payable
    },

    // ==========================================
    // STEP 5: BOOKING LIFECYCLE (Figma Screen 26-29, 66-67)
    // ==========================================
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
            'Testing',               // Sample reached lab and in-process
            'Report Generated',      // Result ready
            'Completed',             // Report uploaded and sent to User
            'Cancelled'
        ],
        default: 'Pending'
    },

    // ==========================================
    // STEP 6: VENDOR & LOGISTICS (Figma Screen 71-75)
    // ==========================================
    // Link to Driver model where vendorType is 'Lab'
    phlebotomistId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', default: null },
    
    paymentStatus: { type: String, enum: ['Pending', 'Done', 'Failed', 'Refunded'], default: 'Pending' },
    paymentMethod: { type: String, enum: ['UPI', 'COD', 'Net Banking', 'Wallet'] },

    // The final output
    reportFile: { type: String, default: null }, // Link to PDF file
    cancelReason: { type: String }

}, { timestamps: true });

module.exports = mongoose.model('LabBooking', labBookingSchema);