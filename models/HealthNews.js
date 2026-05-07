const mongoose = require('mongoose');

const healthNewsSchema = new mongoose.Schema({
    title: { type: String, required: true }, // e.g., "How do doctors service this pandemic"
    category: { type: String, default: "Health Article" }, // Purple text in UI
    image: { type: String, required: true }, // URL of the article banner
    content: { type: String }, // Full article text
    author: { type: String, default: "Admin" },
    readTime: { type: String, default: "5 min read" },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('HealthNews', healthNewsSchema);