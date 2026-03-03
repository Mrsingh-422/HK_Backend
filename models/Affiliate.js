const mongoose = require('mongoose');

const affiliateSchema = new mongoose.Schema({
    title: { type: String, required: true }, // e.g., "Heart Specialist"
    description: { type: String, required: true },
    image: { type: String },
    
    // Contact
    phone: { type: String },
    facebook: { type: String },
    twitter: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Affiliate', affiliateSchema);