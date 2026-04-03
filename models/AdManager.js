const mongoose = require('mongoose');

const adManagerSchema = new mongoose.Schema({
    title: { type: String, required: true, uppercase: true },
    description: { type: String, required: true },
    
    // Multiple Images Array
    images: [{ type: String, required: true }], 
    
    // Kis page par ad dikhani hai (e.g. Medicine Store, Doctor Profile)
    page: { type: String, required: true }, 
    
    status: { 
        type: String, 
        enum: ['Active', 'Inactive'], 
        default: 'Active' 
    },
    
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('AdManager', adManagerSchema);