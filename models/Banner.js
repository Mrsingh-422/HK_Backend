const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
    title: { type: String, required: true },
    image: [{ type: String, required: true }], // Image URL (Cloudinary/S3)
    link: { type: String },  // App Navigation Path e.g. "/medicine/list"
    
    // Kis page par dikhana hai
    category: { 
        type: String, 
        enum: ['Home', 'Medicine', 'Nurse', 'Lab', 'Hospital', 'Ambulance', 'General'], 
        default: 'Home' 
    },
    
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
    priority: { type: Number, default: 0 }, // Banners ka sequence (0, 1, 2...)
    
    startDate: { type: Date, default: Date.now },
    expiryDate: { type: Date },
    
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('Banner', bannerSchema);