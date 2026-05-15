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
     handoffDetails: {
        doctorName: { type: String, default: null },
        wardName: { type: String, default: null },
        duration: { type: String, default: null }, // e.g., "22 mins"
        reasonAtHandoff: { type: String, default: null }, // Figma: "Stable at handoff"
        completedAt: { type: Date, default: null }
    },
    

}, { timestamps: true });

module.exports = mongoose.model('AmbulanceBooking', ambulanceBookingSchema);