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
            
            // --- Lab Page Sections ---
            'searchTest', 'prescriptionTest', 'howItWorks', 'labCare', 'aboutLab', 'research',

            // --- Appointment Page Sections ---
            'findDoctor', 'findConsultant', 'doctorsPriority', 'howToSecure',

            // --- Medicine / Pharmacy Page Sections ---
            'pharmacyPage', 'onlinePharmacyFeatured', 'medicinePrescription', 'bestOfBest', 'recommendedMed', 'aboutMedicine',

            // --- Ambulance Page Sections ---
            'ambulanceHero', 'ambulanceReferralHero', 'emergencyFacility', 'accidentalEmergency', 'medicalEmergency', 'referralAmbulance',

            // --- Hospital Page Sections ---
            'hospitalHero', 'hospitalFacility', 'mainHowItWorks',

            // --- Nurse Page Sections (NEW) ---
            'nurseHero', 'nursePrescription', 'nursingSteps', 'nursingServices', 'experiencedNurses', 'onlyTheBestCare'
        ] 
    },
    
    // =====================================
    // COMMON FIELDS
    // =====================================
    title: { type: String },
    subtitle: { type: String },
    description: { type: String },
    introduction: { type: String },
    images: [{ type: String }], 

    // =====================================
    // LAB / APPOINTMENT / MEDICINE / AMBULANCE / HOSPITAL FIELDS
    // =====================================
    miniTitle: { type: String },
    mainTitle: { type: String },
    searchLabel: { type: String },
    bulkTitle: { type: String },
    bulkDescription: { type: String },
    mainDescription: { type: String },
    badgeText: { type: String },
    buttonText: { type: String },
    statusLabel: { type: String },
    statusValue: { type: String },
    phone1: { type: String },
    phone2: { type: String },
    headerTag: { type: String },
    titlePart1: { type: String },
    titlePart2: { type: String },
    subTitle: { type: String },
    header: { type: String },
    tag: { type: String },
    statusText: { type: String },
    expressTag: { type: String },
    sidebarTitle: { type: String },
    sidebarDescription: { type: String },
    searchPlaceholder: { type: String },
    card1Title: { type: String },
    card1Btn: { type: String },
    card2Title: { type: String },
    card2Btn: { type: String },
    card3Title: { type: String },
    card3Btn: { type: String },
    typeHeading: { type: String },
    tagline: { type: String },
    sectionTag: { type: String },
    highlightText: { type: String },
    subHeader: { type: String },
    carouselImages: [{ type: String }],
    headerTitle: { type: String }, 

    // =====================================
    // NURSE PAGE SPECIFIC FIELDS (NEW)
    // =====================================
    titleEmoji: { type: String },
    uploadLabel: { type: String },
    uploadBtnText: { type: String },
    footerNote: { type: String },
    subheading: { type: String },

    // =====================================
    // DYNAMIC ARRAYS (Mixed Type)
    // =====================================
    steps: { type: mongoose.Schema.Types.Mixed },     
    features: { type: mongoose.Schema.Types.Mixed },  
    skills: { type: mongoose.Schema.Types.Mixed },    
    points: { type: mongoose.Schema.Types.Mixed },    
    items: { type: mongoose.Schema.Types.Mixed },     
    categories: { type: mongoose.Schema.Types.Mixed },
    partners: { type: mongoose.Schema.Types.Mixed }, 
    services: { type: mongoose.Schema.Types.Mixed }, // NEW: Used in Nursing Services

    // =====================================
    // SPECIFIC TO HOMEPAGE 'About Us'
    // =====================================
    workDescription: { type: String },
    missionDescription: { type: String },
    achievementDescription: { type: String }

}, { timestamps: true });

module.exports = mongoose.model('FrontendContent', frontendContentSchema);