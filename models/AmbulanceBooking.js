const mongoose = require('mongoose');

const ambulanceBookingSchema = new mongoose.Schema({
    bookingId: { type: String, unique: true, required: true },
    caseReference: { type: String, unique: true }, // Figma Screen 12
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ambulanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ambulance' },
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' },

     pickupHospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' }, // For Referral Ambulance
     serviceType: { 
        type: String, 
        enum: ['Accident emergency', 'Medical Ambulance', 'Referral Ambulance', 'Quick Response'],
        required: true 
    },
    incidentType: { type: String }, // Road Accident, Trauma, Heart Attack
     pickupLocation: {
        address: { type: String, default: "" },
        lat: { type: Number, default: 0 },
        lng: { type: Number, default: 0 }
    },


    // Screen 41: Triage Facility
    triageLevel: { 
        type: String, 
        enum: ['Emergency', 'Very Urgent', 'Urgent', 'Routine'],
        default: 'Routine'
    },

    // Screen 41: Form Fields
    patientDetails: {
        name: String,
        relation: String,
        age: Number,
        gender: String,
        condition: { type: String, default: 'Stable' }, // Figma Screen 8
        emergencyDescription: String,
        incidentPhoto: String,
        referralCard: String, // Figma Screen 6
        referralReason: String 
    },

    // Screen 36: Securitybelt
    otp: { type: String }, 
    isOtpVerified: { type: Boolean, default: false },

    // Tracking
    status: { 
        type: String, 
        enum: ['Searching', 'Confirmed', 'Arrived', 'Picked-Up', 'En-Route', 'Delivered', 'Cancelled'], 
        default: 'Searching' 
    },
    

    couponDetails: {
        couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', default: null },
        couponCode: { type: String, default: null  },
        discountValue: { type: Number, default: 0 }
    },
    // Screen 44: Price Breakdown
    pricing: {
        ambulanceCharge: { type: Number, default: 0 },
        supportingStaffCharge: { type: Number, default: 0 },
        subtotal: { type: Number, default: 0 }, // Price before discount
        discount: { type: Number, default: 0 }, // Same as couponDetails.discountValue
        total: { type: Number, default: 0 }    // Final payable amount
    },

    // Screen 40: For Referral Bookings
    scheduledAt: { type: Date }, 
    scheduledTime: { type: String }, // e.g., "10:30 AM"



    trackingTimeline: [{
        status: String,
        timestamp: { type: Date, default: Date.now },
        note: String
    }],
     handoffDetails: {
        doctorName: { type: String, default: null },
        wardName: { type: String, default: null },
        duration: { type: String, default: null }, // e.g., "22 mins"
        reasonAtHandoff: { type: String, default: null }, // Figma: "Stable at handoff"
        completedAt: { type: Date, default: null }
    },
    
    // 👇 NEW: Store exactly what was selected
    supportStaffSelected: {
        nurse: { type: Boolean, default: false },
        doctor: { type: Boolean, default: false }
    },

    // 👇 NEW: Payment Lifecycle
    paymentStatus: { 
        type: String, 
        enum: ['Pending', 'Paid', 'Failed', 'Refunded'], 
        default: 'Pending' 
    },
    paymentMethod: { type: String, enum: ['Cash', 'Online', 'Wallet'], default: 'Online' },

    // 👇 NEW: Better Cancellation Tracking
    cancelledBy: { type: String, enum: ['User', 'Driver', 'System', null], default: null },
    cancellationReason: { type: String, default: null },
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

module.exports = mongoose.model('AmbulanceBooking', ambulanceBookingSchema);