const mongoose = require('mongoose');

const subscriptionDiseaseSchema = new mongoose.Schema({
    categoryId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'SubscriptionCategory', 
        required: [true, "Parent Category ID is required"] 
    },
    name: { 
        type: String, 
        required: [true, "Disease name is required"], 
        trim: true 
    }, // e.g., "Dementia", "Dialysis", "Cancer", "Diabetes & Heart Care"
    slug: { 
        type: String, 
        unique: true, 
        lowercase: true, 
        trim: true 
    },
    description: { type: String, default: "" },
    iconImage: { type: String, default: null },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

subscriptionDiseaseSchema.pre('validate', function(next) {
    if (this.name && !this.slug) {
        this.slug = this.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    }
    next();
});

module.exports = mongoose.model('SubscriptionDisease', subscriptionDiseaseSchema);