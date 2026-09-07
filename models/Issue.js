const mongoose = require('mongoose');

const issueSchema = new mongoose.Schema({
    issueNumber: { 
        type: Number, 
        unique: true 
    },
    title: { 
        type: String, 
        required: true, 
        trim: true 
    }, // e.g. "Health locker update issue."
    detailedDescription: { 
        type: String, 
        default: "" 
    },
    category: {
        type: String,
        enum: ['Health Locker', 'Profile', 'Hospital Bed', 'Service Booking', 'Payment', 'Other'],
        default: 'Other'
    },
    status: {
        type: String,
        enum: ['IN PROGRESS', 'RESOLVED'],
        default: 'IN PROGRESS'
    },
    loggedDate: { 
        type: Date, 
        default: Date.now 
    },
    resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        default: null
    },
    resolvedAt: {
        type: Date,
        default: null
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        default: null
    }
}, { timestamps: true });

// 🚀 Auto-Increment Sequential Issue Number (#1, #2, #3...)
issueSchema.pre('save', async function(next) {
    if (this.isNew && !this.issueNumber) {
        const lastIssue = await this.constructor.findOne().sort({ issueNumber: -1 });
        this.issueNumber = lastIssue && lastIssue.issueNumber ? lastIssue.issueNumber + 1 : 1;
    }
    next();
});

module.exports = mongoose.model('Issue', issueSchema);