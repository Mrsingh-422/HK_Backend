// models/FireCase.js
const mongoose = require('mongoose');

const fireCaseSchema = new mongoose.Schema({
    // 1. Case Identity
    caseNo: { 
        type: String, 
        unique: true, 
        required: true,
        default: () => `FIRE-${Math.floor(1000 + Math.random() * 9000)}` // Auto-generate like FIRE-1234
    },

    // 2. Relations
    hqId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'FireHQ', 
        required: true 
    },
    stationId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'FireStation', 
        required: true 
    },
    assignedStaff: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FireStaff' }],
    assignedVehicles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FireVehicle' }],

    // 3. Caller / Victim Details
    callerName: { type: String, required: true },
    callerPhone: { type: String, required: true },
    
    // 4. Incident Details
    fireType: { 
        type: String, 
        enum: ['Residential', 'Industrial', 'Forest', 'Vehicle', 'Other'], 
        default: 'Other' 
    },
    severity: { 
        type: String, 
        enum: ['Low', 'Medium', 'High', 'Critical'], 
        default: 'Medium' 
    },
    severityLevel: { type: String, default: 'Level 1' }, 
    description: { type: String },

    // 5. Location Details (Maps Support)
    address: { type: String, required: true },
    location: {
        lat: { type: Number, required: true },
        lng: { type: Number, required: true }
    },
    responseTime: { type: String },

    // 6. Status Tracking (Matches your Controller Logic)
    status: { 
        type: String, 
        enum: ['Fresh', 'Pending', 'Under Control', 'Critical', 'Closed', 'Archived'], // Added Under Control & Critical
        default: 'Fresh' 
    },

    // 7. Media & Evidence
    incidentImages: [{ type: String }], // Array of image paths
    videoUrl: { type: String },

    // 8. Timestamps for History
    reportedAt: { type: Date, default: Date.now },
    dispatchedAt: { type: Date },
    resolvedAt: { type: Date },

    // 9. Financials (As seen in your Dashboard stats)
    earnings: { type: Number, default: 0 },
    
    // Additional Info
    remarks: { type: String }, // Captain's final notes
    // Figma Screen 10 (Incident Report) ke additional fields
    resourcesUsed: {
        trucksAssigned: { type: Number, default: 0 },
        personnelCount: { type: Number, default: 0 },
        equipmentList: [String], // e.g., ["Hoses", "Ladders", "BA Sets"]
    },
    damageImpact: {
        damageLevel: { type: String, enum: ['Minor', 'Major', 'Total', 'Minor Structural Damage'] },
        injuries: { type: Number, default: 0 },
        casualties: { type: Number, default: 0 }
    },

}, { timestamps: true });

// Geo-spatial index for location-based searching
fireCaseSchema.index({ location: "2dsphere" });

module.exports = mongoose.model('FireCase', fireCaseSchema);