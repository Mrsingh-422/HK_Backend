const mongoose = require('mongoose');

const adminArticleSchema = new mongoose.Schema({
    title: { type: String, required: true },
    author: { type: String, required: true },
    content: { type: String, required: true },
    
    // Category & Subcategory
    category: { 
        type: String, 
        enum: ['Wellness', 'Diet', 'Lifestyle', 'Fitness'], 
        required: true 
    },
    subCategory: { 
        type: String, 
        enum: ['Health', 'Medical', 'Mental Health', 'Nutrition', 'Yoga'], 
        required: true 
    },
    
    // Multiple Images Array
    images: [{ type: String, required: true }], 
    
    status: { 
        type: String, 
        enum: ['Published', 'Draft'], 
        default: 'Published' 
    },
    date: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('AdminArticle', adminArticleSchema);