const mongoose = require('mongoose');

const nursingPrescriptionRequestSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    prescriptionImage: { type: String, required: true }, // Presciption image path
    extractedText: { type: String, default: "" },       // Text parsed by OCR/AI
    
    // Services requested (either AI-extracted or manually corrected/added)
    services: [{
        title: { type: String, required: true },
        description: { type: String, default: "" },
        notes: { type: String, default: "" }
    }],

    location: {
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
        address: {
            houseNo: String,
            landmark: String,
            city: String,
            state: String,
            pincode: String
        }
    },

    // Broadcast list: Nearest 10 approved nurses
    candidateNurses: [{
        nurseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nurse' },
        status: { 
            type: String, 
            enum: ['Pending', 'Submitted', 'Declined', 'Expired'], 
            default: 'Pending' 
        }
    }],

    // Proposals/Bills submitted by nurses
    proposals: [{
        nurseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nurse' },
        servicesPricing: [{
            title: { type: String },
            price: { type: Number }
        }],
        consumablesUsed: [{
            name: { type: String },
            price: { type: Number }
        }],
        priceBreakdown: {
            baseServicePrice: { type: Number, default: 0 },
            consumableTotal: { type: Number, default: 0 },
            taxAmount: { type: Number, default: 0 },
            totalPrice: { type: Number, default: 0 }
        },
        submittedAt: { type: Date, default: Date.now },
        status: { type: String, enum: ['Pending', 'Accepted', 'Rejected'], default: 'Pending' }
    }],

    status: { 
        type: String, 
        enum: ['Broadcasted', 'Completed', 'Expired'], 
        default: 'Broadcasted' 
    },
    
    selectedNurseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nurse', default: null },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'NurseBooking', default: null },
    expiresAt: { type: Date, required: true } // Created time + 6 hours

}, { timestamps: true });

nursingPrescriptionRequestSchema.index({ "location": "2dsphere" });

module.exports = mongoose.model('NursingPrescriptionRequest', nursingPrescriptionRequestSchema);