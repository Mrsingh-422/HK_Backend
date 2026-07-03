const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema({
    planType: { 
        type: String, 
        enum: ['Elder Care', 'Condition Management'], 
        required: true 
    },
    name: { type: String, required: true }, // e.g., 'Basic Annual Care', 'Dementia Care Plan'
    
    // For Condition Management Plan
    diseaseType: { 
        type: String, 
        enum: ['Dementia', 'Dialysis', 'Cancer', null], 
        default: null 
    },

    validityInDays: { type: Number, required: true }, // e.g., 7, 30, 180, 365

    
    price: { type: Number, required: true }, // rupees (₹)
    description: { type: String },
    features: [{ type: String }], // Bullet points list

    termsAndConditions: { type: String, default: "" }, // Terms and Conditions

    // System Enforced limits/benefits
    benefits: {
        freeDoctorAppointmentsCount: { type: Number, default: 0 },
        freeNurseVisitsCount: { type: Number, default: 0 },
        freeLabDeliveriesCount: { type: Number, default: 0 },      // Alag Lab delivery counter
        freeNurseDeliveriesCount: { type: Number, default: 0 },    // Alag Nurse delivery counter
        freePharmacyDeliveriesCount: { type: Number, default: 0 }, // Alag Pharmacy delivery counter
        freeAmbulanceTripsCount: { type: Number, default: 0 }
    },
    
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);