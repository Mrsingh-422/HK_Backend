// models/Phlebotomist.js (Figma: Add Phlebotomist)
const mongoose = require('mongoose');
const phlebotomistSchema = new mongoose.Schema({
    labId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider' },
    name: String,
    phone: String,
    email: String,
    uid: String, // e.g., Anuj115242
    vehicleNumber: String,
    vehicleType: String,
    aadhaarNumber: String,
    address: String,
    profilePic: String,
    status: { type: String, enum: ['Available', 'Busy', 'Offline'], default: 'Available' },
    documents: {
        certificate: String,
        license: String,
        rcImage: String
    }
});
module.exports = mongoose.model('Phlebotomist', phlebotomistSchema);