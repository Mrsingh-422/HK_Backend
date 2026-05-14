const mongoose = require('mongoose');

const ambulanceBookingSchema = new mongoose.Schema({
    bookingId: { type: String, unique: true, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ambulanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ambulance' },
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' },

     serviceType: { 
        type: String, 
        enum: ['Accident emergency', 'Medical Ambulance', 'Referral Ambulance', 'Quick Response'],
        required: true 
    },
    incidentType: { type: String }, // Road Accident, Trauma, Heart Attack


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
        incidentPhoto: String
    },

    // Screen 36: Security
    otp: { type: String }, 
    isOtpVerified: { type: Boolean, default: false },

    // Tracking
    status: { 
        type: String, 
        enum: ['Searching', 'Confirmed', 'Arrived', 'Picked-Up', 'En-Route', 'Delivered', 'Cancelled'], 
        default: 'Searching' 
    },
    
    // Screen 44: Price Breakdown
    pricing: {
        ambulanceCharge: { type: Number, default: 0 },
        supportingStaffCharge: { type: Number, default: 0 }, // Doctor/Nurse
        discount: { type: Number, default: 0 },
        total: { type: Number, default: 0 }
    },

    // Screen 40: For Referral Bookings
    scheduledAt: { type: Date }, 

    trackingTimeline: [{
        status: String,
        timestamp: { type: Date, default: Date.now },
        note: String
    }],
    

}, { timestamps: true });

module.exports = mongoose.model('AmbulanceBooking', ambulanceBookingSchema);