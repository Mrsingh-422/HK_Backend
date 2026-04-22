const mongoose = require('mongoose');

const fireEquipmentSchema = new mongoose.Schema({
    stationId: { type: mongoose.Schema.Types.ObjectId, ref: 'FireStation', required: true },
    equipmentName: { type: String, required: true }, // e.g., 1.5" Attack Hoses
    category: String, // Hoses & Nozzles
    serialNumber: { type: String, unique: true }, // EQ-1049
    status: { type: String, enum: ['Available', 'Maintenance', 'Low Stock'], default: 'Available' },
    totalQty: { type: Number, default: 0 },
    inService: { type: Number, default: 0 },
    inStorage: { type: Number, default: 0 },
    lastHydroTest: Date,
    nextHydroTest: Date,
    specifications: Object, // Diameter, Pressure, etc.
    notes: String
}, { timestamps: true });

module.exports = mongoose.model('FireEquipment', fireEquipmentSchema);