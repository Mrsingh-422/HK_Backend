const mongoose = require('mongoose');

const masterConsumableSchema = new mongoose.Schema({
    itemName: { type: String, required: true, trim: true },
    size: { type: String, trim: true }, // For matching: "5×5 cm, 8 ply"
    category: { type: String, required: true },
    unitType: { type: String, enum: ['Piece', 'Pair', 'Pack', 'Roll', 'Bottle', 'Box'], default: 'Piece' },
    mrp: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('MasterConsumable', masterConsumableSchema);