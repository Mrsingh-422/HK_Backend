// models/MedicineInventory.js
const mongoose = require('mongoose');

const medicineInventorySchema = new mongoose.Schema({
    pharmacyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Pharmacy',
        required: true,
        index: true
    },
    medicineId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Medicine',
        required: true,
        index: true
    },
    batch_number: {
        type: String,
        required: true, // Recommended true for standard pharmacy auditing
        trim: true
    },
    mrp: {
        type: Number,
        required: true
    },
    vendor_price: {
        type: Number, // Pharmacy apna selling price yahan set karegi
        required: true
    },
    stock_quantity: {
        type: Number,
        default: 0
    },
    expiry_date: {
        type: Date
    },
    manufacturing_date: {
        type: Date,
        default: null
    },
    hsn_number: {
        type: String,
        required: false,
        trim: true,
        default: null
    },
    is_available: {
        type: Boolean,
        default: true
    },
    isReturnAllowed: {
    type: Boolean,
    default: false // 👈 Vendor can toggle true/false per batch
},
isReplacementAllowed: {
    type: Boolean,
    default: false // 👈 Vendor can toggle true/false per batch
}
}, { timestamps: true });

// Ensure ek pharmacy ek medicine ko ek hi baar list kare
medicineInventorySchema.index({ pharmacyId: 1, medicineId: 1, batch_number: 1 }, { unique: true });

module.exports = mongoose.model('MedicineInventory', medicineInventorySchema);