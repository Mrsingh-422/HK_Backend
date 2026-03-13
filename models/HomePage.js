const mongoose = require('mongoose');

const frontendContentSchema = new mongoose.Schema({
    section: { 
        type: String, 
        required: true, 
        unique: true, 
        enum:[
            // --- Homepage Sections ---
            'aboutUs', 'ambulance', 'homepage', 'introduction', 
            'getHealthApp', 'hospitals', 'nursing', 'featuredProducts', 'laboratory',
            
            // --- Lab Page Sections (NEW) ---
            'searchTest', 'prescriptionTest', 'howItWorks', 'labCare', 'aboutLab', 'research'
        ] 
    },
    
    // =====================================
    // COMMON FIELDS
    // =====================================
    title: { type: String },
    subtitle: { type: String },
    description: { type: String },
    introduction: { type: String },
    images: [{ type: String }], // Stores URLs

    // =====================================
    // SPECIFIC TO LAB PAGES (NEW FIELDS)
    // =====================================
    miniTitle: { type: String },
    mainTitle: { type: String },
    searchLabel: { type: String },
    
    // Prescription Page specific
    bulkTitle: { type: String },
    bulkDescription: { type: String },
    mainDescription: { type: String },
    badgeText: { type: String },
    
    // Lab Care / Research specific
    buttonText: { type: String },
    statusLabel: { type: String },
    statusValue: { type: String },
    phone1: { type: String },
    phone2: { type: String },

    // Dynamic Arrays (Using Mixed type so it can accept your frontend JSON arrays easily)
    steps: { type: mongoose.Schema.Types.Mixed },     // For How It Works [{title, desc, iconKey, colorKey}]
    features: { type: mongoose.Schema.Types.Mixed },  // For Lab Care (objects) & Research (strings)
    skills: { type: mongoose.Schema.Types.Mixed },    // For About Lab [{name, percentage}]

    // =====================================
    // SPECIFIC TO HOMEPAGE 'About Us'
    // =====================================
    workDescription: { type: String },
    missionDescription: { type: String },
    achievementDescription: { type: String }

}, { timestamps: true });

module.exports = mongoose.model('FrontendContent', frontendContentSchema);