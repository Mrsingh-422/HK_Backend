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
     // 🚨 ADDED: To store user's selected or manually added tests
     requestedTests: [{
        name: { type: String, required: true },
        price: { type: Number, default: 0 }, // 👈 Added: Price from master list
        masterId: { type: mongoose.Schema.Types.ObjectId, default: null }, // 👈 Added: Reference ID
        productType: { type: String, enum: ['LabTest', 'LabPackage', 'Manual'], default: 'Manual' } // 👈 Added: Type indicator
    }],


    collectionType: { type: String, enum: ['Home Collection', 'Visit Lab'], required: true },
    appointmentDate: { type: Date }, 
    appointmentTime: { type: String },

    
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
        items: [{
            medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', default: null },
            name: { type: String },
            mrp: { type: Number, default: 0 },
            pricePerUnit: { type: Number },
            quantity: { type: Number },
            totalPrice: { type: Number },
            
            // 🚨 ADDED: Item-level GST details for Prescription Inquiries
            hsn_number: { type: String, default: "30049011" },
            taxableAmount: { type: Number, default: 0 },
            cgstPercent: { type: Number, default: 6 },
            sgstPercent: { type: Number, default: 6 },
            cgstAmount: { type: Number, default: 0 },
            sgstAmount: { type: Number, default: 0 }
        }],
        itemTotal: { type: Number, default: 0 },
        
        // 🚨 ADDED: Global Invoice GST Summaries
        taxableTotal: { type: Number, default: 0 },
        cgstTotal: { type: Number, default: 0 },
        sgstTotal: { type: Number, default: 0 },

        deliveryCharge: { type: Number, default: 0 },
        totalAmount: { type: Number, default: 0 }
    }


}, { timestamps: true });

module.exports = mongoose.model('LabPrescriptionRequest', labPrescriptionRequestSchema);