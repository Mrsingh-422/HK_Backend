// models/NurseBooking.js
const mongoose = require('mongoose');

const nurseBookingSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    nurseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nurse', required: true },
    assignedStaffId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Driver' // Yahan 'Driver' hi Staff Nurse hai
    },
    bookingId: { type: String, unique: true }, // Add this
    
    patientDetails: {
        name: String,
        age: Number,
        gender: String,
        relation: String
    },
    serviceType: String, 
    healthDetails: { // Figma: Height, DOB, Lang
        height: String,
        dob: Date,
        language: String,
        specialInstructions: String
    },
    schedule: {
        startDate: Date,
        startTime: String,
        duration: String,
        endDate: Date
    },
    totalPrice: Number, // Add this
    status: { 
        type: String, 
        enum: ['Pending', 'Confirmed', 'Assigned', 'On-The-Way', 'Arrived', 'In-Progress', 'Completed', 'Cancelled'], 
        default: 'Pending' 
    },
    rejectionReason: String,
    rejectionNote: String,
    schedule: {
        startDate: Date,
        startTime: String,
        endDate: Date,
        duration: String
    },
    needConsumable: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('NurseBooking', nurseBookingSchema);