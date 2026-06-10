// models/PoliceContent.js
const mongoose = require('mongoose');

const policeContentSchema = new mongoose.Schema({
    contentType: { 
        type: String, 
        enum: ['About', 'Help', 'Terms'], // About, Help, and Terms & Conditions
        required: true, 
        unique: true 
    },
    title: { 
        type: String, 
        required: true 
    },
    content: { 
        type: String, 
        required: true // Figma Screen 35 ke according raw text/HTML format support karega
    },
    
    // Help Section ke FAQs mapping
    faqs: [{
        question: { type: String },
        answer: { type: String }
    }],

    // Figma Screen 21 Integration (Contact with Admin overlay parameters)
    supportContact: {
        phone: { type: String, default: "+91 9876543210" },
        email: { type: String, default: "help@gmail.com" }
    },

    lastUpdatedBy: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'PoliceHQ', 
        default: null 
    }
}, { timestamps: true });

module.exports = mongoose.model('PoliceContent', policeContentSchema);