const mongoose = require('mongoose');

const prescriptionRequestSchema = new mongoose.Schema({
    requestId: { type: String, unique: true, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pharmacy', required: true },
    
    // AI Detected Info
    doctorName: { type: String },
    prescriptionDate: { type: Date },
    prescriptionImage: { type: String, required: true }, // Uploaded path
    
    // Duration preference
    durationType: { type: String, enum: ['Full Course', 'Custom'], default: 'Full Course' },
    
    // Requested Medicines with Custom Durations
    requestedMedicines: [{
        name: { type: String, required: true },
        dosage: { type: String },
        durationDays: { type: Number, default: 15 },
        isSelected: { type: Boolean, default: true }
    }],
    
    address: {
        addressType: { type: String, default: 'Home' },
        name: { type: String },
        phone: { type: String },
        houseNo: { type: String },
        sector: { type: String },
        city: { type: String },
        pincode: { type: String }
    },

    status: {
        type: String,
        enum: [
            'Pending Review',       // User has submitted the prescription
            'Reviewing',            // Pharmacist has opened the request
            'Bill Generated',       // Pharmacist has matched items and added pricing
            'Rejected'              // Prescription invalid / medicines out of stock
        ],
        default: 'Pending Review'
    },

    // Verified bill added by Pharmacist during review
    verifiedBill: {
        items: [{
            medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine' },
            name: { type: String },
            pricePerUnit: { type: Number },
            quantity: { type: Number },
            totalPrice: { type: Number }
        }],
        itemTotal: { type: Number, default: 0 },
        deliveryCharge: { type: Number, default: 0 },
        totalAmount: { type: Number, default: 0 }
    }
}, { timestamps: true });

module.exports = mongoose.model('PharmacyPrescriptionRequest', prescriptionRequestSchema);