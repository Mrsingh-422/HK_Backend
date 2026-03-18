    // models/Lab.js (Lab Provider Model)
    const mongoose = require('mongoose');

    const labSchema = new mongoose.Schema({
        name: { type: String, required: true },
        email: { type: String, unique: true, sparse: true },
        phone: { type: String, unique: true, sparse: true },
        password: { type: String, required: true, select: false },
        role: { type: String, enum: ['Lab'], default: 'Lab', immutable: true }, 
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
            // --- Image Arrays ---
            labImages: [{ type: String }],           
            labCertificates: [{ type: String }],    
            labLicenses: [{ type: String }],         
            gstCertificates: [{ type: String }],     
            drugLicenses: [{ type: String }],        
            otherCertificates: [{ type: String }],   

            // --- Details Fields ---
            documentState: { type: String },        
            issuingAuthority: { type: String },   
            gstNumber: { type: String },             
            experience: { type: String },          
            
            // Drug License Type (Figma Screenshot 3 options)
            drugLicenseType: { 
                type: String, 
                enum: ['Retail', 'Wholesale', 'Restricted', 'Blood Bank', 'None'],
                default: 'None'
            }
                },


    
            rejectionReason: { type: String, default: null },

        

        // Lab Specific Labels
        isHomeCollectionAvailable: { type: Boolean, default: false },
        isRapidServiceAvailable: { type: Boolean, default: false },
        isInsuranceAccepted: { type: Boolean, default: false },
        about: String,
        rating: { type: Number, default: 4.5 },
        totalReviews: { type: Number, default: 0 }

        
        

    }, { timestamps: true });

    module.exports = mongoose.model('Lab', labSchema);