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
    is_available: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

// Ensure ek pharmacy ek medicine ko ek hi baar list kare
medicineInventorySchema.index({ pharmacyId: 1, medicineId: 1 }, { unique: true });

module.exports = mongoose.model('MedicineInventory', medicineInventorySchema);