const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
    // --- Links ---
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    
    // Agar doctor hospital staff hai toh yahan hospital ID store hogi (Auto-fetch logic from Doctor)
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },

    // --- Patients (Figma: Multi-Patient Support) ---
    patients: [{
        patientName: { type: String, required: true },
        patientAge: { type: Number, required: true },
        gender: { type: String, enum: ['Male', 'Female', 'Other'] },
        relation: { type: String, default: 'Self' }, // 'Self', 'Spouse', 'Child' etc.
        reasonForVisit: { type: String },
        isMainUser: { type: Boolean, default: false } 
    }],

    // --- Booking Details ---
    appointmentDate: { type: Date, required: true },
    appointmentTime: { type: String, required: true }, // "09:30 AM"
    consultationType: { 
        type: String, 
        enum: ['Video Consult', 'Clinic Visit', 'Home Visit'], 
        required: true 
    },
    
    // --- Finance & Payment ---
    totalAmount: { type: Number, required: true },
    doctorFees: { type: Number },   // Actual Doctor's charge
    platformFees: { type: Number }, // App service charge
    paymentStatus: { 
        type: String, 
        enum: ['Pending', 'Paid', 'Failed', 'Refunded', 'Refund-Initiated'], 
        default: 'Pending' 
    },
    paymentMethod: { type: String, enum: ['UPI', 'Card', 'Cash', 'Net Banking'] },
    transactionId: { type: String },

    // --- Status Logic (Production Level) ---
    status: { 
        type: String, 
        enum: [
            'Pending',              // Independent Doctor context
            'Hospital-Pending',     // Hospital Doctor context (Admin approval needed)
            'Confirmed',            // Approved by Admin or Accepted by Doctor
            'In-Progress',          // Visit/Call started
            'Completed',            // Checkup finished
            'Cancelled-By-User',    // User ne app se cancel kiya
            'Cancelled-By-Doctor',  // Doctor ne dashboard se cancel kiya
            'Cancelled-By-Hospital',// Hospital Admin ne cancel kiya
            'No-Show',              // Patient nahi aaya
            'Rescheduled'           // Time change request
        ], 
        default: 'Pending' 
    },

    // --- Tracking (Figma: On the way screen) ---
    tracking: {
        otp: { type: String }, // Figma: "Start Visit OTP" (e.g. 8902)
        doctorLocation: {
            lat: { type: Number },
            lng: { type: Number }
        },
        eta: { type: String } // Estimated time of arrival (e.g. "12 min")
    },

    // --- Cancellation & Refund Tracking ---
    cancellationDetails: {
        cancelledBy: { type: mongoose.Schema.Types.ObjectId }, // User/Doctor/Hospital Admin ID
        reason: { type: String },
        cancelledAt: { type: Date },
        refundId: { type: String }
    },

    bookingId: { type: String, unique: true } // Unique Receipt ID: e.g., HK-A1B2C3
}, { timestamps: true });

module.exports = mongoose.model('Appointment', appointmentSchema);