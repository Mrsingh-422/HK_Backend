const mongoose = require('mongoose');

const prescriptionRequestSchema = new mongoose.Schema({
    requestId: { type: String, unique: true, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pharmacy', required: true },
    
    doctorName: { type: String },
    prescriptionDate: { type: Date },
    prescriptionImage: { type: String, required: true },
    
    durationType: { type: String, enum: ['Full Course', 'Custom'], default: 'Full Course' },
    
    requestedMedicines: [{
        name: { type: String, required: true },
        dosage: { type: String, default: '1-0-1' },
        durationDays: { type: Number, default: 15 },
        isSelected: { type: Boolean, default: true },
        mrp: { type: Number, default: 0 } // Added Admin MRP backup
    }],
    
    address: {
        addressType: { type: String, default: 'Home' },
        name: { type: String },
        phone: { type: String },
        houseNo: { type: String },
        city: { type: String },
        pincode: { type: String }
    },

    status: {
        type: String,
        enum: ['Pending Review', 'Reviewing', 'Bill Generated', 'Rejected'],
        default: 'Pending Review'
    },

    verifiedBill: {
        items: [{
            medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', default: null }, // Null safe for manual entries
            name: { type: String },
            mrp: { type: Number, default: 0 }, // Added verified MRP
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