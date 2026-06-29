// models/LabPrescriptionRequest.js
const mongoose = require('mongoose');

const labPrescriptionRequestSchema = new mongoose.Schema({
    requestId: { type: String, unique: true, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    labId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lab', required: true },
    prescriptionImage: { type: String, required: true }, // Path to uploaded file

    patients: [{
        patientId: { type: String }, // 'Self' or family member ID
        name: String,
        age: Number,
        gender: { type: String, enum: ['Male', 'Female', 'Other'] },
        relation: String
    }],

    collectionType: { type: String, enum: ['Home Collection', 'Visit Lab'], required: true },
    
    address: {
        name: String,
        phone: String,
        houseNo: String,
        sector: String,
        landmark: String,
        city: String,
        state: String,
        pincode: String,
        addressType: { type: String, default: 'Home' }
    },

    status: {
        type: String,
        enum: ['Pending Review', 'Reviewing', 'Bill Generated', 'Rejected', 'Paid', 'Pending Payment'],
        default: 'Pending Review'
    },
    rejectReason: { type: String, default: null },

    // Verified bill compiled by the Lab during manual audit
    verifiedBill: {
        tests: [{
            testId: { type: mongoose.Schema.Types.ObjectId, ref: 'LabTest' },
            name: { type: String },
            mrp: { type: Number, default: 0 },
            pricePerUnit: { type: Number, default: 0 }
        }],
        packages: [{
            packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'LabPackage' },
            name: { type: String },
            mrp: { type: Number, default: 0 },
            pricePerUnit: { type: Number, default: 0 }
        }],
        itemTotal: { type: Number, default: 0 },
        homeVisitCharge: { type: Number, default: 0 },
        totalAmount: { type: Number, default: 0 }
    }
}, { timestamps: true });

module.exports = mongoose.model('LabPrescriptionRequest', labPrescriptionRequestSchema);