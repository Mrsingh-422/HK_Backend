const mongoose = require('mongoose');

const fireVehicleSchema = new mongoose.Schema({
    stationId: { type: mongoose.Schema.Types.ObjectId, ref: 'FireStation', required: true },
    vehicleName: { type: String, required: true }, // Engine 1
    vehicleType: { type: String, required: true }, // Type 1 Pumper
    assetId: { type: String, required: true, unique: true }, // ENG-01
    modelYear: String,
    licensePlate: String,
    pumpCapacity: String, // 1,500 GPM
    waterTank: String,    // 500 Gal
    status: { 
        type: String, 
        enum: ['Available', 'Maintenance', 'Out of Service'], 
        default: 'Available' 
    },
    profileImage: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('FireVehicle', fireVehicleSchema);