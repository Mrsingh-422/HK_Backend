// models/Nurse.js (Nurse Model)
const mongoose = require('mongoose');

const nurseSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, unique: true, sparse: true },
    phone: { type: String, unique: true, sparse: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['Nurse'], default: 'Nurse', immutable: true },
    profileStatus: { type: String, enum: ['Incomplete', 'Pending', 'Approved', 'Rejected'], default: 'Incomplete' },
    token: { type: String, default: null },
    isActive: { type: Boolean, default: true },

    profileImage: { type: String, default: null },

     // Location Details
    country: { type: String, default: null },
    state: { type: String, default: null },
    city: { type: String, default: null },
    address: { type: String, default: null },
    location: {
        lat: Number,
        lng: Number
    },
 documents: {
        nursingCertificates: [{ type: String }],    // Figma: Nursing Certificate
        licensePhotos: [{ type: String }],          // Figma: License Photo
        gstCertificates: [{ type: String }],        // Figma: GST Certificate (Optional)
        experienceCertificates: [{ type: String }], // Figma: Award/Experience Certificate
        otherCertificates: [{ type: String }],      // Figma: Other Certificate

        documentState: { type: String },            // Figma: State Dropdown
        issuingAuthority: { type: String },         // Figma: Issuing Authority Name
        gstNumber: { type: String },                // Figma: GST Certificate Number
        experience: { type: String }                // Figma: Award / Experience Input
    },
    
        rejectionReason: { type: String, default: null },

    // Nurse Specific
    experienceYears: { type: Number, default: 0 },
    speciality: { type: String, default: null }, // e.g., ICU, Pediatric
    gender: { type: String, enum: ['Male', 'Female', 'Other'] },
    about: { type: String, default: "" },
    location: {
            lat: { type: Number, default: 0 },
            lng: { type: Number, default: 0 }
        },


}, { timestamps: true });
nurseSchema.index({ location: "2dsphere" });


module.exports = mongoose.model('Nurse', nurseSchema);