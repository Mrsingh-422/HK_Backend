const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true }, // Short description
    image: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Article', articleSchema);