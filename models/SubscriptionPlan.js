const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema({
    categoryId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'SubscriptionCategory', 
        required: [true, "Category reference is required"] 
    },
    // 🩺 Supports MULTIPLE diseases under one plan
    diseaseIds: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'SubscriptionDisease' 
    }],

    name: { 
        type: String, 
        required: [true, "Plan name is required"], 
        trim: true 
    }, // e.g., 'Chronic Disease Combo Shield (Diabetes + Cardiology)'
    
    validityInDays: { 
        type: Number, 
        required: [true, "Validity in days is required"] 
    }, // e.g., 30, 90, 180, 365
    
    price: { 
        type: Number, 
        required: [true, "Plan price is required"],
        min: 0 
    },
    
    description: { type: String, default: "" },
    features: [{ type: String }],
    termsAndConditions: { type: String, default: "" },

    // 🎁 System Enforced Benefits & COD Guarantee
    benefits: {
        unlimitedCodAccess: { type: Boolean, default: true }, // 👈 Subscribed users get COD always unlocked
        freeDoctorAppointmentsCount: { type: Number, default: 0 },
        freeNurseVisitsCount: { type: Number, default: 0 },
        freeLabDeliveriesCount: { type: Number, default: 0 },
        freeNurseDeliveriesCount: { type: Number, default: 0 },
        freePharmacyDeliveriesCount: { type: Number, default: 0 },
        freeAmbulanceTripsCount: { type: Number, default: 0 }
    },
    
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);