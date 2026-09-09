const mongoose = require('mongoose');

const subscriptionCategorySchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: [true, "Category name is required"], 
        unique: true, 
        trim: true 
    }, // e.g., "Elder Care", "Condition Management", "Post-Op Recovery"
    slug: { 
        type: String, 
        unique: true, 
        lowercase: true, 
        trim: true 
    },
    description: { type: String, default: "" },
    iconImage: { type: String, default: null },
    isDiseaseSpecific: { 
        type: Boolean, 
        default: false 
    }, // If true, Admin must select 1 or more diseases
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

subscriptionCategorySchema.pre('validate', function(next) {
    if (this.name && !this.slug) {
        this.slug = this.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    }
    next();
});

module.exports = mongoose.model('SubscriptionCategory', subscriptionCategorySchema);