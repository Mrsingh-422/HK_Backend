// models/Lab.js (Lab Provider Model)
const mongoose = require('mongoose');

const labSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, unique: true },
    phone: { type: String, required: true },
    password: { type: String, select: false },
    
    // Location Details
    country: String,
    state: String,
    city: String,
    address: String,
    location: {
        lat: Number,
        lng: Number
    },

    // Figma Labels
    isHomeCollectionAvailable: { type: Boolean, default: true },
    isRapidServiceAvailable: { type: Boolean, default: false },
    isInsuranceAccepted: { type: Boolean, default: false },
    
    about: String,
    image: String, // Clinic image
    rating: { type: Number, default: 4.5 },
    totalReviews: { type: Number, default: 0 },
    
    isActive: { type: Boolean, default: true },
    token: String
}, { timestamps: true });

module.exports = mongoose.model('Lab', labSchema);