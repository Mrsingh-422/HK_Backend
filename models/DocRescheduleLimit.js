// models/DocRescheduleLimit.js
const mongoose = require('mongoose');

const docRescheduleLimitSchema = new mongoose.Schema({
    maxLimit: { 
        type: Number, 
        default: 2, 
        required: true 
    },
    updatedBy: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin' // Super Admin ID जिसने limit set kari hai
    }
}, { timestamps: true });

module.exports = mongoose.model('DocRescheduleLimit', docRescheduleLimitSchema);