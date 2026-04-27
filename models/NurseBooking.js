const mongoose = require('mongoose');

const nurseBookingSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    nurseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nurse', required: true },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'NurseService' }, // Link to specific service
    assignedStaffId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' }, 
    bookingId: { type: String, unique: true },
    
    patientDetails: {
        name: String,
        age: Number,
        gender: String,
        relation: String,
        image: String // Figma Screen 3 member image
    },
    assessmentLocation: { type: String, default: 'At Home' }, // Figma Screen 3
    triageFacility: String, // Figma Screen 3 dropdown

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
    totalPrice: Number,
    
    status: { 
        type: String, 
        enum: ['Pending', 'Confirmed', 'Assigned', 'On-The-Way', 'Arrived', 'In-Progress', 'Completed', 'Cancelled'], 
        default: 'Pending' 
    },
    needConsumable: { type: Boolean, default: false },
    prescriptionImage: String,
    couponCode: String
}, { timestamps: true });

module.exports = mongoose.model('NurseBooking', nurseBookingSchema);