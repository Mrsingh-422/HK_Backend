const mongoose = require('mongoose');

const healthLockerSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    
    // Type batayega ki ye Folder hai ya File
    type: { type: String, enum: ['folder', 'file'], required: true },
    
    // Folder ke liye name, File ke liye Title
    name: { type: String, required: true, trim: true },

    // Agar root par hai to parentId null hoga, warna parent folder ki ID
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'HealthLocker', default: null },

    // --- Sirf Files ke liye niche waale fields use honge ---
    doctorName: { type: String }, 
    notes: { type: String },
    images: [{ type: String }], // Array for multiple pages
    fileCount: { type: Number, default: 0 },
    date: { type: Date, default: Date.now }

}, { timestamps: true });

module.exports = mongoose.model('HealthLocker', healthLockerSchema);