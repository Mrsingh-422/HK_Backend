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
        enum: ['General-Bed', 'Emergency-Bed'], // general bed for hospital booking direct and emergency bed for ambulance brought patients
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
    rescheduleReason: { type: String, default: "" }, // 👈 Dynamic reason for doctor rescheduling
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
        enum: ['Pending', 'Hospital-Pending', 'Confirmed', 'In-Progress', 'Discharge-Pending', 'Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital', 'No-Show', 'Rescheduled'], 
        default: 'Pending' 
    },
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
    cancellationCount: { type: Number, default: 0 },
    rescheduleCount: { type: Number, default: 0 },

    // for hospital transfer
    pendingDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', default: null }, // 👈 Handover target doctor
    treatmentHistory: [{
    fromDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', default: null },
    toDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', default: null },
    action: { 
        type: String, 
        enum: ['Initial-Assignment', 'Transfer-Initiated', 'Transfer-Accepted', 'Discharged'], 
        default: 'Initial-Assignment' 
    },
    notes: { type: String, default: "" },
    timestamp: { type: Date, default: Date.now },
    
    // --- NEW: ADDMISSION SHIFT DURATION TRACKING ---
    startTime: { type: Date, default: null },
    endTime: { type: Date, default: null },
    durationDisplay: { type: String, default: "" } // e.g. "2 hr 15 mins"
}],
    clinicalSummary: {
        diagnosis: { type: String, default: "" },
        investigation: { type: String, default: "" },
        treatmentResult: { type: String, default: "" },
        dischargeNote: { type: String, default: "" },
        dischargedAt: { type: Date, default: null },

        uploadedReports: [{ type: String }], 

        
        // Supports updateClinicalSummary endpoint
        chiefComplaint: { type: String, default: "" },
        triagePriority: { type: String, default: "" },
        admissionNote: { type: String, default: "" },
        bloodGroup: { type: String, default: "" }
    },

    // --- NEW: DYNAMIC BEDSIDE CARE TEAM CO-DOCTORS ARRAY ---
    bedsideCareTeam: [{
        doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
        status: { type: String, enum: ['Pending', 'Accepted', 'In-Progress', 'Completed', 'Rejected'], default: 'Pending' },
        requestReason: { type: String, default: "" },
        patientConditionAtRequest: { type: String, default: "" },
        priority: { type: String, enum: ['Most Urgent', 'Urgent', 'Routine'], default: 'Routine' },
        rejectionReason: { type: String, default: "" },
        
        // Co-Doctor Clinical feedback notes
        specialistFeedback: [{
            observation: { type: String, default: "" },
            patientCondition: { type: String, default: "" },
            priorityRating: { type: String, default: "" },
            submittedAt: { type: Date, default: Date.now }
        }],
        requestedAt: { type: Date, default: Date.now },
        respondedAt: { type: Date, default: null }
    }],
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

module.exports = mongoose.model('Appointment', appointmentSchema);