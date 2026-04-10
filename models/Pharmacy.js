// models/Pharmacy.js (Pharmacy Model)
const mongoose = require('mongoose');

const pharmacySchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, unique: true, sparse: true },
    phone: { type: String, unique: true, sparse: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['Pharmacy'], default: 'Pharmacy', immutable: true },
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
        pharmacyImages: [{ type: String }],       // Figma: Pharmacy Image
        pharmacyCertificates: [{ type: String }], // Figma: Pharmacy Certificate Image
        pharmacyLicenses: [{ type: String }],     // Figma: Pharmacy License Certificate
        gstCertificates: [{ type: String }],      // Figma: GST Certificate (Optional)
        drugLicenses: [{ type: String }],        // Figma: Drug License
        otherCertificates: [{ type: String }],   // Figma: Other Certificate (Optional)

        documentState: { type: String },          // Figma: State
        issuingAuthority: { type: String },       // Figma: Issuing Authority Name
        gstNumber: { type: String },              // Figma: GST Certificate Number
        drugLicenseType: {                        // Figma: Drug License Type
            type: String, 
            enum: ['Retail', 'Wholesale', 'Restricted', 'Blood Bank', 'None'],
            default: 'Retail'
        }
    },

   
        rejectionReason: { type: String, default: null },

    // Pharmacy Specific (Potential future fields)
    isHomeDeliveryAvailable: { type: Boolean, default: true },
    is24x7: { type: Boolean, default: false },
    about: { type: String, default: "" },
    location: {
        lat: { type: Number, default: 0 },
        lng: { type: Number, default: 0 }
    },



}, { timestamps: true });
pharmacySchema.index({ location: "2dsphere" });


module.exports = mongoose.model('Pharmacy', pharmacySchema);