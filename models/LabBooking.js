// models/LabBooking.js
const mongoose = require('mongoose');
const labBookingSchema = new mongoose.Schema({
    bookingId: { type: String, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    labId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lab' },
    phlebotomistId: { type: mongoose.Schema.Types.ObjectId, ref: 'Phlebotomist', default: null },
    
    // Figma Patients Selection
    patients: [{
        patientName: String,
        age: Number,
        gender: String,
        relation: String
    }],

    items: {
        tests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'LabTest' }],
        packages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'LabPackage' }]
    },

    // Figma Collection Type
    collectionType: { type: String, enum: ['Home Collection', 'Visit Lab'] },
    collectionAddress: Object, // Pincode, House No, etc.
    
    // Slot
    appointmentDate: Date,
    appointmentTime: String,

    // Pricing Breakdown
    billSummary: {
        itemTotal: Number,
        priceDiscount: Number,
        homeVisitCharge: { type: Number, default: 0 }, // +Rs 80 in Figma
        rapidDeliveryCharge: { type: Number, default: 0 }, // +Rs 29 in Figma
        totalAmount: Number
    },

    status: { 
        type: String, 
        enum: ['Pending', 'Confirmed', 'Phlebotomist Assigned', 'Sample Collected', 'Processing', 'Report Uploaded', 'Cancelled'],
        default: 'Pending'
    },
        reportFile: { type: String, default: null }, // Path to the PDF Report
}, { timestamps: true });

module.exports = mongoose.model('LabBooking', labBookingSchema);