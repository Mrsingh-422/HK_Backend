// models/NurseBooking.js
const mongoose = require('mongoose');

const nurseBookingSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    nurseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nurse', required: true },
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
        enum: ['Pending', 'Confirmed', 'In-Progress', 'Completed', 'Cancelled'], 
        default: 'Pending' 
    },
    needConsumable: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('NurseBooking', nurseBookingSchema);