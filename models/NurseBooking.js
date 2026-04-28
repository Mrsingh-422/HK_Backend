const mongoose = require('mongoose');

const nurseBookingSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    nurseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nurse', required: true },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'NurseService' }, // Link to specific service
    assignedStaffId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' }, 
    bookingId: { type: String, unique: true },
    
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
    triageFacility: { 
        type: String, 
        enum: ['Emergency', 'Very Urgent', 'Urgent', 'Routine'],
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
        startTime: String,
        duration: String, // One Day One Time, etc.
        endDate: Date
    },
    
    // Price breakdown
    basePrice: Number,
    slotSurcharge: { type: Number, default: 0 }, // +79
    fasterServiceCharge: { type: Number, default: 0 }, // +29 per hour
    taxAmount: { type: Number, default: 0 },
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
        enum: ['Pending', 'Confirmed', 'Assigned', 'On-The-Way', 'Arrived', 'In-Progress', 'Completed', 'Cancelled'], 
        default: 'Pending' 
    },
    selectedConsumables: [{
        consumableId: { type: mongoose.Schema.Types.ObjectId, ref: 'NurseConsumable' },
        itemName: String,
        price: Number,
        unitType: String
    }],
    needConsumable: { type: Boolean, default: false },
    prescriptionImage: String,
    couponCode: String
}, { timestamps: true });

module.exports = mongoose.model('NurseBooking', nurseBookingSchema);