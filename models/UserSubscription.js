const mongoose = require('mongoose');

const userSubscriptionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
    
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    
    status: { 
        type: String, 
        enum: ['Pending', 'Active', 'Expired', 'Cancelled'], 
        default: 'Pending' 
    },
    
    // Tracker for consumed/remaining system benefits
    remainingBenefits: {
        freeDoctorAppointmentsCount: { type: Number, default: 0 },
        freeNurseVisitsCount: { type: Number, default: 0 },
        freeLabDeliveriesCount: { type: Number, default: 0 },
        freeNurseDeliveriesCount: { type: Number, default: 0 },
        freePharmacyDeliveriesCount: { type: Number, default: 0 },
        freeAmbulanceTripsCount: { type: Number, default: 0 }
    },

    paymentStatus: { 
        type: String, 
        enum: ['Pending', 'Paid', 'Failed'], 
        default: 'Pending' 
    },
    
    // Payment integrations matching your system design
    razorpayOrderId: { type: String, default: "" },
    razorpayPaymentId: { type: String, default: "" },
    razorpaySignature: { type: String, default: "" },
    paymentDetails: { type: Object, default: {} }

}, { timestamps: true });

module.exports = mongoose.model('UserSubscription', userSubscriptionSchema);