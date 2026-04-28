const mongoose = require('mongoose');

const nurseServiceSchema = new mongoose.Schema({
    nurseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nurse', required: true },
    
    // Figma dropdown: 'Daily Care' or 'Package'
    type: { type: String, enum: ['Daily Care', 'Package'], required: true },
    
    title: { type: String, required: true }, // Name of service
    description: String, // Nurse Service Description

    // --- FIGMA SCREEN 42 PRICING FIELDS ---
    oneDayPrice: { type: Number, default: 0 },       // For one day one time price
    multipleDaysPrice: { type: Number, default: 0 }, // For multiple Days Price
    hourlyPrice: { type: Number, default: 0 },       // For per hours price
    
    amount: { type: Number, default: 0 },            // Base Amount
    discountPercentage: { type: Number, default: 0 }, // Discount Percentage %
    finalPrice: { type: Number, required: true },    // Price after discount (Actual price used for booking)

    // Figma selection & text fields
    consumablesUsed: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'NurseConsumable' 
    }], 
    procedureIncluded: String,  // Procedure Included text
    servicesOffered: String,    // Services Offered text
    
    prescriptionRequired: { type: Boolean, default: false },
    photos: [{ type: String }],
    status: { type: String, enum: ['Approved', 'Pending', 'Rejected'], default: 'Pending' },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('NurseService', nurseServiceSchema);