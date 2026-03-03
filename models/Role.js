const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true }, // उदा: "Pharmacy Manager"
    role_ids: [{ type: Number }], // SQL की ID (1, 2, 28, 30...)
    description: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Role', roleSchema);