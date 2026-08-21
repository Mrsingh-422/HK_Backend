// models/Appointment.js
const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' },
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },
    bedId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bed', default: null }, // For hospital admissions

    ambulanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ambulance', default: null }, // Link to Ambulance if brought by driver
    bookingType: { type: String, enum: ['Appointment', 'Admission'], default: 'Appointment' },
    bedBookingType: {
        type: String,
        enum: ['General-Bed', 'Emergency-Bed'], // general bed for hospital booking direct and emergency bed for ambulance brought patients
        default: 'General-Bed'
    },
    bookingReason: { type: String, default: "" },       // Reason for bed booking

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

    appointmentDate: { type: Date },
    appointmentTime: { type: String },
    rescheduleReason: { type: String, default: "" }, // 👈 Dynamic reason for doctor rescheduling
    consultationType: {
        type: String,
        enum: ['Video Consult', 'Clinic Visit', 'Home Visit']
    },

    // --- Pricing & Coupon Logic ---
    pricingBreakdown: {
        baseFee: { type: Number },
        originalBaseFee: { type: Number, default: 0 }, // 🚨 NEW: Actual doctor consult fee before subscription
        visitCharges: { type: Number, default: 0 }, // Distance based
        extraCharges: { type: Number, default: 0 }, // Fast delivery/Emergency
        discountAmount: { type: Number, default: 0 },
        subtotal: { type: Number },

        cancellationFeeApplied: { type: Number, default: 0 },
        noShowFeeApplied: { type: Number, default: 0 }
    },
    couponDetails: {
        couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' },
        couponCode: { type: String },
        discountValue: { type: Number }
    },
    insuranceDetails: {
        hasInsurance: { type: Boolean, default: false },
        insuranceNumber: { type: String, default: "" },
        companyName: { type: String, default: "" },
        insuranceType: { type: String, default: "" },
        insuranceDocument: { type: String, default: null }, // Snapshot path of PDF or image
        // 🚀 NEW: TPA Approval Letter PDF from insurance company
        approvalLetterPdf: { type: String, default: null }, 
        // 🚀 NEW: Approval status ('Pending' until PDF is uploaded, then 'Approved')
        approvalStatus: { 
            type: String, 
            enum: ['Pending', 'Approved', 'Rejected'], 
            default: 'Pending' 
        }
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
        subscriptionDetails: {
            isSubscriptionApplied: { type: Boolean, default: false }, // 🚨 NEW: True if booked via subscription
            userSubscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserSubscription', default: null }, // 🚨 NEW: Reference to active subscriber sheet
            planName: { type: String, default: "" } // 🚨 NEW: Active Plan Name (e.g. Basic Annual Care)
        },
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
        bloodGroup: { type: String, default: "" },

        // 🚨 ADD THESE NEW KEYS FOR THE PRINTABLE DISCHARGE SHEET:
        dateOfSurgery: { type: Date, default: null },
        conditionDuringAdmission: { type: String, default: "" },
        conditionDuringDischarge: { type: String, default: "" },

        dischargeSummaryPdf: { type: String, default: null },
        vitals: { // 🚀 NEW: Final discharge vitals
            bp: { type: String, default: "" },
            pulse: { type: String, default: "" },
            temp: { type: String, default: "" },
            spo2: { type: String, default: "" }
        }
    },
    clinicalLogs: [{
        doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
        observation: { type: String, required: true }, // Figma: Diagnostic findings
        patientCondition: { type: String, default: 'Stable' }, // Recovering, Stable, Critical, Deteriorating
        priorityRating: { type: String, default: 'Routine' }, // Routine, Urgent, Critical
        vitals: { // 🚀 NEW: Attending doctor round vitals
            bp: { type: String, default: "" },
            pulse: { type: String, default: "" },
            temp: { type: String, default: "" },
            spo2: { type: String, default: "" }
        },
        loggedAt: { type: Date, default: Date.now }
    }],


    // --- NEW: DYNAMIC BEDSIDE CARE TEAM CO-DOCTORS ARRAY ---
    bedsideCareTeam: [{
        doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
        status: { type: String, enum: ['Pending', 'Accepted', 'In-Progress', 'Completed', 'Rejected'], default: 'Pending' },
        requestReason: { type: String, default: "" },
        patientConditionAtRequest: { type: String, default: "" },
        priority: { type: String, enum: ['Most Urgent', 'Urgent', 'Routine'], default: 'Routine' },
        rejectionReason: { type: String, default: "" },

        // 🚀 NEW: Specialist recommended medicines before final discharge compilation
        recommendedMedicines: [{
            name: { type: String, required: true },
            dosage: { type: String },
            frequency: { type: String },
            duration: { type: String },
            instructions: { type: String, default: "" },
            // 🚀 NEW TYPE ENUM: Determines if med is for hospital stay or post-discharge at home
            type: {
                type: String,
                enum: ['Active-Stay', 'Discharge-Home'],
                default: 'Active-Stay'
            },
            addedAt: { type: Date, default: Date.now }
        }],

        // Co-Doctor Clinical feedback notes
        specialistFeedback: [{
            observation: { type: String, default: "" },
            patientCondition: { type: String, default: "" },
            priorityRating: { type: String, default: "" },
            vitals: { // 🚀 NEW: Specialist checkup vitals
                bp: { type: String, default: "" },
                pulse: { type: String, default: "" },
                temp: { type: String, default: "" },
                spo2: { type: String, default: "" }
            },
            submittedAt: { type: Date, default: Date.now }
        }],
        requestedAt: { type: Date, default: Date.now },
        respondedAt: { type: Date, default: null }
    }],
    activeMedications: [{
        medicineName: { type: String, required: true },
        dosage: { type: String }, // e.g., "1 tab", "5ml Injection"
        frequency: { type: String }, // e.g., "TDS", "BD", "Once Daily"
        instructions: { type: String, default: "" }, // e.g., "Give after nebulization"
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
        status: { type: String, enum: ['Active', 'Stopped'], default: 'Active' },
        startDate: { type: Date, default: Date.now },
        stoppedDate: { type: Date, default: null }
    }],
    paymentDetails: {
        razorpayPaymentId: { type: String, default: "" },
        razorpayOrderId: { type: String, default: "" },
        razorpaySignature: { type: String, default: "" },
        method: { type: String, default: "" },      // upi, card, netbanking, wallet
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
    },
    cancellationDetails: {
        cancelledBy: { type: mongoose.Schema.Types.ObjectId, refPath: 'role' },
        reason: { type: String, default: "" },
        cancelledAt: { type: Date, default: null },
        isPermanent: { type: Boolean, default: false },       // 👈 TRUE = Refund, FALSE = Reschedule-Ready
        refundAmountCalculated: { type: Number, default: 0 }, // 👈 Stores net payout return
        penaltyApplied: { type: Number, default: 0 }          // 👈 Stores dynamic cancellation fee applied
    },

    tracking: {
        otp: { type: String, default: null },
        isOtpVerified: { type: Boolean, default: false },
        noShowReason: { type: String, default: "" }
    }



}, { timestamps: true });

module.exports = mongoose.model('Appointment', appointmentSchema);