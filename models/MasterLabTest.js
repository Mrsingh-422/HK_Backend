const mongoose = require('mongoose');

const masterLabTestSchema = new mongoose.Schema({
    testName: { type: String, required: true, unique: true },
    testCode: { type: String }, // Internal unique code (e.g., LPL026)
    mainCategory: { type: String, enum: ['Radiology', 'Pathology'], required: true },
    category: { type: String }, // e.g. "Diabetes", "Fever"
    sampleType: { type: String }, // e.g. "Blood", "Urine", "NA"
    
    // Naya Data jo CSV se aayega
    parameters: [String], // Array: ["Hemoglobin", "WBC Count", "Platelets"]
    
    // Detailed Description as Array (Tata 1mg style sections)
    detailedDescription: [{
        sectionTitle: String, // e.g. "What is CBC?", "Why is it done?"
        sectionContent: String
    }],

    // FAQs (Multiple Questions)
    faqs: [{
        question: String,
        answer: String
    }],
    gender: { 
        type: String, 
        enum: ['Male', 'Female', 'Both'], 
        default: 'Both' 
    },

    pretestPreparation: { type: String }, // Generic precaution: "Fasting required"
    standardMRP: { type: Number }, // Admin suggested price
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('MasterLabTest', masterLabTestSchema); 