// models/MasterReportTemplate.js
const mongoose = require('mongoose');

const masterReportTemplateSchema = new mongoose.Schema({
    testName: { 
        type: String, 
        required: true, 
        unique: true, 
        trim: true,
        index: true // 👈 Fast searching aur bulk CSV updates ke liye indexing lagayi hai
    }, // e.g., "Complete Blood Count (CBC)"
    parameters: [{
        name: { 
            type: String, 
            required: true, 
            trim: true 
        }, // e.g., "Haemoglobin (HB)"
        unit: { 
            type: String, 
            default: "" 
        }, // e.g., "g/dL"
        
        // 🚨 Note: Inhe String rakha hai taaki numeric benchmarks ("70" / "100") 
        // aur qualitative benchmarks ("Negative" / "Absent") dono securely store ho sakein [1].
        minRef: { 
            type: String, 
            default: "" 
        }, 
        maxRef: { 
            type: String, 
            default: "" 
        },
        
        type: { 
            type: String, 
            enum: ['numeric', 'text'], 
            default: 'numeric' // 👈 Helper for frontend to open Numeric Keyboard dynamically [1]
        },
        method: { 
            type: String, 
            default: "N/A" 
        }, // e.g., "Spectrophotometry"
        machine: { 
            type: String, 
            default: "Automated Analyzer" 
        }, // e.g., "Yumizen H2500"
        interpretation: { 
            type: String, 
            default: "" 
        }, // e.g., "Low HB may indicate anemia."
    }]
}, { timestamps: true });

module.exports = mongoose.model('MasterReportTemplate', masterReportTemplateSchema);