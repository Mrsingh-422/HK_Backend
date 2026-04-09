const mongoose = require('mongoose');

const availabilitySchema = new mongoose.Schema({
    vendorId: { 
        type: mongoose.Schema.Types.ObjectId, 
        required: true, 
        refPath: 'vendorType',
        unique: true 
    },
    vendorType: { 
        type: String, 
        enum: ['Lab', 'Pharmacy', 'Nurse','Doctor'], 
        required: true 
    },

    // Global Settings
    morningSlots: { type: Boolean, default: true },
    afternoonSlots: { type: Boolean, default: true },
    eveningSlots: { type: Boolean, default: true },
    
    startTime: { type: String, default: "09:00" }, 
    endTime: { type: String, default: "21:00" },   
    
    // Sirf Lab aur Nurse ke liye use hoga
    slotDuration: { type: Number, default: 30 }, 
    maxClientsPerSlot: { type: Number, default: 0 }, // 0 means unlimited bookings
    premiumSlots: [{
        time: String,
        extraFee: { type: Number, default: 0 }
    }],

    // "Delete" option ke liye: Vendor jin slots ko hide karna chahta hai
    unavailableSlots: [String], // Example: ["10:30", "14:15"]

    offDays: [String] // ["Sunday"]

}, { timestamps: true });

module.exports = mongoose.model('Availability', availabilitySchema);