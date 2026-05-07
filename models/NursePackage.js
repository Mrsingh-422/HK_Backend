const mongoose = require('mongoose');

const nursePackageSchema = new mongoose.Schema({
    nurseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nurse', required: true },
    packageName: { type: String, required: true },
    description: String,
    
    // Nurse ki apni saari services ka bundle
    includedServices: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'CareService' 
    }],

    // Triple Pricing Structure
    pricing: {
        oneDay: { base: Number, discount: Number, final: Number },
        multipleDays: { base: Number, discount: Number, final: Number },
        hourly: { base: Number, discount: Number, final: Number }
    },

    // Optional Add-on consumables for the package
    consumablesUsed: [{
        masterItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MasterConsumable' },
        discountPercentage: { type: Number, default: 0 },
        finalPrice: { type: Number, required: true }
    }],

    photos: [String],
    prescriptionRequired: { type: Boolean, default: false },
    status: { type: String, default: 'Approved' }, // Direct List
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('NursePackage', nursePackageSchema);