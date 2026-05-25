// models/Appointment.js
const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' },
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },
    bedId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bed', default: null }, // For hospital admissions

    ambulanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ambulance', default: null }, // Link to Ambulance if brought by driver
    bedBookingType: { 
        type: String, 
        enum: ['General-Bed', 'Emergency-Bed'], 
        default: 'General-Bed' 
    },

    patients: [{
        patientName: { type: String, required: true },
        patientAge: { type: Number, required: true },
        gender: { type: String, enum: ['Male', 'Female', 'Other'] },
        relation: { type: String, default: 'Self' },
        reasonForVisit: { type: String },
        isMainUser: { type: Boolean, default: false } 
    }],
    address: {
        name: String,        
        phone: String,       
        houseNo: String,
        sector: String,
        landmark: String,
        city: String,
        state: String,
        country: String,
        pincode: String,
        addressType: { type: String, default: 'Home' }
    },

    appointmentDate: { type: Date},
    appointmentTime: { type: String }, 
    consultationType: { 
        type: String, 
        enum: ['Video Consult', 'Clinic Visit', 'Home Visit']
    },
    
    // --- Pricing & Coupon Logic ---
    pricingBreakdown: {
        baseFee: { type: Number },
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

    // For Hospital Admissions
    startDate: { type: Date }, // Admission start
    endDate: { type: Date },   // Admission end
    stayDuration: { type: Number }

}, { timestamps: true });

module.exports = mongoose.model('Appointment', appointmentSchema);