const mongoose = require('mongoose');

const subscriptionCategorySchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: [true, "Category name is required"], 
        unique: true, 
        trim: true 
    },
    slug: { 
        type: String, 
        lowercase: true, 
        trim: true 
    },
    description: { 
        type: String, 
        default: "" 
    },
    iconImage: { 
        type: String, 
        default: null 
    },
    isDiseaseSpecific: { 
        type: Boolean, 
        default: false 
    },
    displayOrder: { 
        type: Number, 
        default: 0 
    },
    isActive: { 
        type: Boolean, 
        default: true 
    }
}, { timestamps: true });

// 🚀 Safe Slug Generation Hook (No next() conflict)
subscriptionCategorySchema.pre('save', function() {
    if (this.name && !this.slug) {
        this.slug = this.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    }
});

module.exports = mongoose.model('SubscriptionCategory', subscriptionCategorySchema);