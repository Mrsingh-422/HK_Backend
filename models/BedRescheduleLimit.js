// models/BedRescheduleLimit.js
const mongoose = require('mongoose');

const bedRescheduleLimitSchema = new mongoose.Schema({
    maxLimit: { 
        type: Number, 
        default: 2, 
        required: true 
    },
    updatedBy: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin' // Kon se Super Admin ne update kiya hai uski ID
    }
}, { timestamps: true });

module.exports = mongoose.model('BedRescheduleLimit', bedRescheduleLimitSchema);