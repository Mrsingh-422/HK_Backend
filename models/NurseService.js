const mongoose = require('mongoose');

const nurseServiceSchema = new mongoose.Schema({
    nurseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nurse', required: true },
    careSubCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'CareService' }, 
    title: String,
    description: String,
    type: { type: String, enum: ['Daily Care', 'Package'], default: 'Daily Care' },
    
    // Keys aligned with controller: base, discount, final
    pricing: {
        oneDay: { base: Number, discount: Number, final: Number },
        multipleDays: { base: Number, discount: Number, final: Number },
        hourly: { base: Number, discount: Number, final: Number }
    },

    consumablesUsed: [{
        masterItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MasterConsumable' },
        discountPercentage: Number,
        finalPrice: Number
    }],

    procedureIncluded: String,
    servicesOffered: String,
    photos: [String],
    prescriptionRequired: { type: Boolean, default: false },
    // Direct 'Approved' to skip pending
    status: { type: String, enum: ['Approved', 'Pending', 'Rejected'], default: 'Approved' },
    rejectionReason: String
}, { timestamps: true });

module.exports = mongoose.model('NurseService', nurseServiceSchema);