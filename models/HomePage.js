const mongoose = require('mongoose');

const frontendContentSchema = new mongoose.Schema({
    section: { 
        type: String, 
        required: true, 
        unique: true, 
        enum: ['aboutUs', 'ambulance', 'homepage', 'introduction', 
            'getHealthApp', 'hospitals', 'nursing',
            'featuredProducts', 'laboratory'] // Defines which section this data belongs to
    },
    
    // Common Fields
    title: { type: String },
    subtitle: { type: String },
    
    // Images Array (Stores URLs)
    images: [{ type: String }],

    // Specific to 'About Us'
    workDescription: { type: String },
    missionDescription: { type: String },
    achievementDescription: { type: String },

    // Specific to 'Ambulance' (Optional extra description)
    description: { type: String } ,
    
// ✅ This field is now used for Ambulance, Hospital, Nursing, Lab, Product etc.
    introduction: { type: String } 

}, { timestamps: true });

module.exports = mongoose.model('FrontendContent', frontendContentSchema);