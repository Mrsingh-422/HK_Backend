// models/UnbanRequest.js
const mongoose = require('mongoose');

const unbanRequestSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    reason: { type: String, required: true }, // User ka likha hua explanation
    status: { 
        type: String, 
        enum: ['Pending', 'Approved', 'Rejected'], 
        default: 'Pending' 
    },
    adminComments: { type: String, default: "" },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    resolvedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('UnbanRequest', unbanRequestSchema);