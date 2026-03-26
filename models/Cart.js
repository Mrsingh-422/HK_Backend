const mongoose = require('mongoose');

const cartSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    
    // --- LAB SECTION ---
    labCart: {
        labId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lab' },
        categoryType: { type: String, enum: ['Pathology', 'Radiology', 'Package', null], default: null },
        items: [{
            productType: { 
                type: String, 
                enum: ['LabTest', 'LabPackage'], // <--- Inhe Change Karein
                required: true 
            },
            itemId: { 
                type: mongoose.Schema.Types.ObjectId, 
                refPath: 'labCart.items.productType', // Yeh ab sahi model dhund lega
                required: true 
            },
            name: String,
            price: Number,
            quantity: { type: Number, default: 1 }
        }]
    },

    // --- PHARMACY SECTION (Skeleton for future use) ---
    pharmacyCart: {
        pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pharmacy' },
        items: [{
            medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine' },
            name: String,
            price: Number,
            quantity: { type: Number, default: 1 }
        }]
    }

}, { timestamps: true });

module.exports = mongoose.model('Cart', cartSchema);