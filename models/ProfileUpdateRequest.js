const mongoose = require('mongoose');

const profileUpdateRequestSchema = new mongoose.Schema({
    vendorId: { 
        type: mongoose.Schema.Types.ObjectId, 
        required: true, 
        refPath: 'vendorModel' 
    },
    vendorModel: { 
        type: String, 
        enum: ['Hospital', 'Doctor', 'Nurse', 'Pharmacy', 'Lab', 'Ambulance', 'Driver','PoliceHQ', 'FireHQ'  ], 
        required: true 
    },
    updatedFields: { 
        type: Object, 
        required: true 
    }, // Holds proposed fields safely as an un-merged object
    status: { 
        type: String, 
        enum: ['Pending', 'Approved', 'Rejected'], 
        default: 'Pending' 
    },
    rejectionReason: { 
        type: String, 
        default: "" 
    },
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        default: null 
    }
}, { timestamps: true });

module.exports = mongoose.model('ProfileUpdateRequest', profileUpdateRequestSchema);