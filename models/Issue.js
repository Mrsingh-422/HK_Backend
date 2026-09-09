const mongoose = require('mongoose');

const issueSchema = new mongoose.Schema({
    issueNumber: { type: Number, index: true },
    ticketId: { type: String, unique: true },

    reporterId: { 
        type: mongoose.Schema.Types.ObjectId, 
        required: true, 
        refPath: 'reporterModel' 
    },
    reporterModel: { 
        type: String, 
        required: true, 
        enum: [
            'User', 'Doctor', 'Hospital', 'Lab', 'Pharmacy', 'Nurse', 'Ambulance', 'Driver',
            'FireHQ', 'FireStation', 'FireStaff',
            'PoliceHQ', 'PoliceStation', 'PoliceStaff'
        ] 
    },

    platform: {
        type: String,
        enum: ['Web', 'App', 'Android', 'iOS'],
        default: 'App',
        required: true
    },
    appVersion: { type: String, default: "" },

    title: { type: String, required: true, trim: true },
    detailedDescription: { type: String, required: true },
    category: { type: String, trim: true, default: 'General' },
    priority: { type: String, enum: ['Low', 'Medium', 'High', 'Urgent'], default: 'Medium' },
    attachments: [{ type: String }],

    status: {
        type: String,
        enum: ['OPEN', 'UNDER REVIEW', 'IN PROGRESS', 'RESOLVED', 'REJECTED', 'CLOSED'],
        default: 'OPEN'
    },

    timeline: [{
        status: { type: String, required: true },
        note: { type: String, default: "" },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
        updatedByName: { type: String, default: "System" },
        updatedByRole: { type: String, default: "Admin" },
        timestamp: { type: Date, default: Date.now }
    }],

    resolutionDetails: {
        resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
        resolutionNote: { type: String, default: "" },
        resolvedAt: { type: Date, default: null }
    }
}, { timestamps: true });

issueSchema.pre('save', async function() {
    if (this.isNew) {
        if (!this.issueNumber) {
            const lastIssue = await this.constructor.findOne().sort({ issueNumber: -1 });
            this.issueNumber = (lastIssue && lastIssue.issueNumber) ? lastIssue.issueNumber + 1 : 1;
        }
        if (!this.ticketId) {
            this.ticketId = `HK-ISS-${Date.now().toString().slice(-6)}`;
        }
    }
});

module.exports = mongoose.model('Issue', issueSchema);