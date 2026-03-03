const mongoose = require('mongoose');

const tabSchema = new mongoose.Schema({
    tabId: { type: Number, required: true, unique: true }, // PHP वाली ID (1, 28, 31 आदि)
    name: { type: String, required: true },               // विभाग का नाम (Pharmacy, Doctor)
    category: { type: String },                           // (Optional) जैसे 'Vendors', 'Drivers'
}, { timestamps: true });

module.exports = mongoose.model('Tab', tabSchema);