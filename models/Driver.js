const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema({
    // Dynamic Reference
    vendorId: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'vendorType' },
    vendorType: { type: String, enum: ['Lab', 'Pharmacy', 'Nurse','Hospital', 'Ambulance'], required: true },

    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true }, // Phone unique kar diya
    password: { type: String, required: true, select: false },
    username: { type: String, unique: true, required: true }, // Username unique hai

    country:{type:String},
    state: { type: String },
    city:{type:String},
    
    // Figma Screenshot fields
    profilePic: { type: String },
    documents: {
        certificate: String,
        license: String,
        rcImage: String
    },
    vehicleNumber: String,
    vehicleType: String,
    aadhaarNumber: String,
    address: String,
    
    status: { type: String, enum: ['Available', 'Busy', 'Offline'], default: 'Available' },
    token: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Driver', driverSchema);  