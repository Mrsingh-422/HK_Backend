// models/MasterReportTemplate.js
const mongoose = require('mongoose');

const masterReportTemplateSchema = new mongoose.Schema({
    testName: { 
        type: String, 
        required: true, 
        trim: true,
        index: true 
    },
    // Gender scope for the entire template: 'Male', 'Female', or 'Both'
    gender: { 
        type: String, 
        enum: ['Male', 'Female', 'Both'], 
        default: 'Both',
        index: true
    },
    parameters: [{
        name: { 
            type: String, 
            required: true, 
            trim: true 
        },
        unit: { 
            type: String, 
            default: "" 
        },
        minRef: { 
            type: String, 
            default: "" 
        }, 
        maxRef: { 
            type: String, 
            default: "" 
        },
        gender: {
            type: String,
            enum: ['Male', 'Female', 'Both'],
            default: 'Both'
        },
        type: { 
            type: String, 
            enum: ['numeric', 'text'], 
            default: 'numeric'
        },
        method: { 
            type: String, 
            default: "N/A" 
        },
        machine: { 
            type: String, 
            default: "Automated Analyzer" 
        },
        interpretation: { 
            type: String, 
            default: "" 
        }
    }]
}, { timestamps: true });

// Compound index to allow same test name to have distinct templates per gender
masterReportTemplateSchema.index({ testName: 1, gender: 1 }, { unique: true });

module.exports = mongoose.model('MasterReportTemplate', masterReportTemplateSchema);