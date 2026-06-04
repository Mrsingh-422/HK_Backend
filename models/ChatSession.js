// models/ChatSession.js
const mongoose = require('mongoose');

const chatSessionSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        unique: true // Ek user ki ek hi consolidated chat thread rahegi
    },
    messages: [{
        sender: { type: String, enum: ['user', 'bot'], required: true },
        text: { type: String, required: true },
        timestamp: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

module.exports = mongoose.model('ChatSession', chatSessionSchema);