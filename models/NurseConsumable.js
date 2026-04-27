const mongoose = require('mongoose');

const nurseConsumableSchema = new mongoose.Schema({
    nurseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Nurse',
        required: true
    },
    itemName: {
        type: String,
        required: [true, "Item name is required"],
        trim: true
    },
    category: {
        type: String,
        required: [true, "Category is required"],
        // Example categories from Figma: Injection, Dressing, etc.
    },
    unitType: {
        type: String,
        required: [true, "Unit type is required"],
        enum: ['Piece', 'Pair', 'Pack', 'Roll', 'Bottle', 'Box'], // Figma Screen 14/15
        default: 'Piece'
    },
    price: {
        type: Number,
        required: [true, "Price is required"],
        min: 0
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { 
    timestamps: true 
});

// Search indexing for the "Search Consumable" bar in Screen 8/34
nurseConsumableSchema.index({ itemName: 'text', category: 'text' });

module.exports = mongoose.model('NurseConsumable', nurseConsumableSchema);