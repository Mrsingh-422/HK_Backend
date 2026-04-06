const mongoose = require('mongoose');

// --- Master Conditions (Fever, Gastritis, etc.) ---
const conditionSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    isMajor: { type: Boolean, default: false }, // Agar 'Yes/No' radio button wala banana hai (Asthma, Diabetes)
    isActive: { type: Boolean, default: true }
});

// --- Master Allergies (Apple, Aspirin, etc.) ---
const allergySchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    isActive: { type: Boolean, default: true }
});

const MasterCondition = mongoose.model('MasterCondition', conditionSchema);
const MasterAllergy = mongoose.model('MasterAllergy', allergySchema);

module.exports = { MasterCondition, MasterAllergy };