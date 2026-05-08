const mongoose = require('mongoose');

const nurseBookingSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    nurseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nurse', required: true },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'NurseService' }, // Link to specific service
    packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'NursePackage' },
    assignedStaffId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' }, 
    bookingId: { type: String, unique: true },
     // Snapshot of service at time of booking
   serviceDetails: {
        title: { type: String },
        type: { type: String }, 
        duration: { type: String },
        basePrice: { type: Number },
        procedureIncluded: { type: String },
        servicesOffered: { type: String }
    },
    
    // Pricing Breakdown
     priceBreakdown: {
        baseServicePrice: Number,    // Service final price * units
        slotSurcharge: Number,       // Premium time/date fee
        consumableTotal: Number,     // Sum of all items selected
        couponDiscount: { type: Number, default: 0 }, // 👈 Added this
        fasterServiceCharge: Number, // Express delivery
        taxAmount: Number,
        totalPrice: Number           // Final grand total
    },
    couponCode: { type: String, uppercase: true },
    appliedCoupon: {
        couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' },
        discountAmount: { type: Number, default: 0 },
        couponName: String
    },
    
    patients: [{
        patientId: { type: String }, // 'Self' or family member ID
        name: String,
        age: Number,
        gender: { type: String, enum: ['Male', 'Female', 'Other'] },
        relation: String
    }],
     assessmentLocation: { 
        type: String, 
        enum: ['At Home', 'At Hospital'], 
        required: true 
    },
    

    healthDetails: { 
        height: String,
        dob: Date,
        language: String,
        specialInstructions: String
    },
    schedule: {
    startDate: Date,
    endDate: Date,
    startTime: String, // "14:00"
    endTime: String,   // "16:00"
    duration: { 
        type: String, 
        enum: ['One day One Time', 'For Multiple Days', 'Acc. To Per/Hours'] 
    }
},
    
    // Price breakdown
    basePrice: Number,
    // slotSurcharge: { type: Number, default: 0 }, // +79
    // fasterServiceCharge: { type: Number, default: 0 }, // +29 per hour
    // taxAmount: { type: Number, default: 0 },
    totalPrice: Number,
    address: {
        name: String,        // Delivery Recipient Name
        phone: String,       // Contact Number
        houseNo: String,
        sector: String,
        landmark: String,
        city: String,
        state: String,
        country: String,
        pincode: String,
        addressType: { type: String, default: 'Home' }
    },

    
    status: { 
        type: String, 
         enum: ['Pending', 'Confirmed', 'Assigned', 'On-The-Way', 'Arrived', 'Service-Started', 'Completed', 'Cancelled'],  
        default: 'Pending' 
    },
    selectedConsumables: [{
        consumableId: { type: mongoose.Schema.Types.ObjectId, ref: 'MasterConsumable' },
        itemName: String,
        price: Number, // Price after nurse's discount
        unitType: String
    }],
    needConsumable: { type: Boolean, default: false },
    prescriptionImage: String,
    couponCode: String,

}, { timestamps: true });
nurseBookingSchema.index({ nurseId: 1, status: 1 });
nurseBookingSchema.index({ "schedule.startDate": 1, "schedule.endDate": 1 });
nurseBookingSchema.index({ userId: 1 });

module.exports = mongoose.model('NurseBooking', nurseBookingSchema);