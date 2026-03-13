const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },

    patients: [{
        patientName: { type: String, required: true },
        patientAge: { type: Number, required: true },
        gender: { type: String, enum: ['Male', 'Female', 'Other'] },
        relation: { type: String, default: 'Self' },
        reasonForVisit: { type: String },
        isMainUser: { type: Boolean, default: false } 
    }],

    appointmentDate: { type: Date, required: true },
    appointmentTime: { type: String, required: true }, 
    consultationType: { 
        type: String, 
        enum: ['Video Consult', 'Clinic Visit', 'Home Visit'], 
        required: true 
    },
    
    // Payments
    totalAmount: { type: Number, required: true },
    doctorFees: { type: Number },
    platformFees: { type: Number },
    paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Failed', 'Refunded', 'Refund-Initiated'], default: 'Pending' },
    transactionId: { type: String },
    medicalReport: { type: String }, // Figma: Upload Medical Report path

    // --- Production Flow Status ---
    status: { 
        type: String, 
        enum: [
            'Pending', 'Hospital-Pending', 'Confirmed', 'In-Progress', 
            'Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 
            'Cancelled-By-Hospital', 'No-Show', 'Rescheduled'
        ], 
        default: 'Pending' 
    },

    // --- Step 4 & 5 Logic: Video Call & Live Tracking ---
    videoRoomId: { type: String, default: null }, // Meeting ID for Video Call
    tracking: {
        otp: { type: String }, // Figma: 8902
        liveLocation: {
            lat: Number,
            lng: Number,
            lastUpdated: Date
        },
        eta: { type: String } // e.g., "12 min"
    },

    cancellationDetails: {
        cancelledBy: { type: mongoose.Schema.Types.ObjectId },
        reason: String,
        cancelledAt: Date
    },

    bookingId: { type: String, unique: true } 
}, { timestamps: true });

module.exports = mongoose.model('Appointment', appointmentSchema);