// models/Role.js
const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true }, // e.g., "Manager", "Accountant"
    tabIds: [{ type: Number }], // Array of tabIds e.g., [1, 2, 28, 31]
    description: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Role', roleSchema);