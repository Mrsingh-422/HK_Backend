// models/Message.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true, index: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, required: true }, // Doctor or User ID
    senderType: { 
        type: String, 
        enum: ['User', 'Doctor'], 
        required: true 
    },
    text: { type: String, required: true },
}, { timestamps: true }); // Automatically stores 'createdAt' for message timing

module.exports = mongoose.model('Message', messageSchema);