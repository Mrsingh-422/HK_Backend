// models/Appointment.js
const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' },
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },
    bedId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bed', default: null }, // For hospital admissions

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
        enum: ['Video Consult', 'Clinic Visit', 'Home Visit']
    },
    
    // --- Pricing & Coupon Logic ---
    pricingBreakdown: {
        baseFee: { type: Number, required: true },
        visitCharges: { type: Number, default: 0 }, // Distance based
        extraCharges: { type: Number, default: 0 }, // Fast delivery/Emergency
        discountAmount: { type: Number, default: 0 },
        subtotal: { type: Number }
    },
    couponDetails: {
        couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' },
        couponCode: { type: String },
        discountValue: { type: Number }
    },

    totalAmount: { type: Number }, // Final Payable
    paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Failed', 'Refunded', 'Refund-Initiated'], default: 'Pending' },
    transactionId: { type: String },
    
    // System Fields
    status: { 
        type: String, 
        enum: ['Pending', 'Hospital-Pending', 'Confirmed', 'In-Progress', 'Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital', 'No-Show', 'Rescheduled'], 
        default: 'Pending' 
    },
    bedId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bed', default: null },
    stayDuration: { type: Number, default: 0 }, // For Bed Booking (Number of days)
    bookingType: { type: String, enum: ['Appointment', 'Admission'], default: 'Appointment' },
       bookingId: { type: String, unique: true },
       triageLevel: { type: String, enum: ['Emergency', 'Very Urgent', 'Urgent', 'Routine'] },
    wardName: { type: String },
    bedNumber: { type: String },
    specialServices: [{ 
        serviceName: String, 
        price: Number 
    }],

}, { timestamps: true });

module.exports = mongoose.model('Appointment', appointmentSchema);