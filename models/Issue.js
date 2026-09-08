const mongoose = require('mongoose');

const issueSchema = new mongoose.Schema({
    issueNumber: { 
        type: Number, 
        index: true 
    },
    title: { 
        type: String, 
        required: [true, "Issue title is required"], 
        trim: true 
    },
    detailedDescription: { 
        type: String, 
        default: "" 
    },
    category: {
        type: String,
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

// 🚀 Fixed & Safe Async Auto-Increment Hook (No next() conflict)
issueSchema.pre('save', async function() {
    if (this.isNew && !this.issueNumber) {
        const lastIssue = await this.constructor.findOne().sort({ issueNumber: -1 });
        this.issueNumber = (lastIssue && lastIssue.issueNumber) ? lastIssue.issueNumber + 1 : 1;
    }
});

module.exports = mongoose.model('Issue', issueSchema);