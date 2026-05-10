// models/HospitalService.js
const mongoose = require('mongoose');
const serviceSchema = new mongoose.Schema({
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' },
    serviceName: { type: String, required: true }, // Z+ Security, VIP Bed
    price: { type: Number, required: true },
    image: { type: String },
    description: String
}, { timestamps: true });
module.exports = mongoose.model('HospitalService', serviceSchema);