const mongoose = require('mongoose');

const subscriptionDiseaseSchema = new mongoose.Schema({
    categoryId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'SubscriptionCategory', 
        required: [true, "Parent Category ID is required"],
        index: true
    },
    name: { 
        type: String, 
        required: [true, "Disease / Condition name is required"], 
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
    isActive: { 
        type: Boolean, 
        default: true 
    }
}, { timestamps: true });

// 🚀 Compound Index: Ek category ke under duplicate disease name nahi banega
subscriptionDiseaseSchema.index({ categoryId: 1, name: 1 }, { unique: true });

// 🚀 Safe Auto-Slug Generation (No next() conflict)
subscriptionDiseaseSchema.pre('save', function() {
    if (this.name && !this.slug) {
        this.slug = this.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    }
});

module.exports = mongoose.model('SubscriptionDisease', subscriptionDiseaseSchema);