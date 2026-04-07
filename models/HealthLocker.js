const mongoose = require('mongoose');

const healthLockerSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    
    // User can type any name (e.g. "Mom's Reports", "Dr. Batra Clinic")
    folderName: { 
        type: String, 
        required: true,
        trim: true 
    },
    
    title: { type: String, required: true }, 
    doctorName: { type: String }, // Figma: "Nice doctor"
    notes: { type: String },
    
    // Support for multiple pages/images in one record
    images: [{ type: String }], 
    
    fileCount: { type: Number, default: 0 },
    date: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('HealthLocker', healthLockerSchema);