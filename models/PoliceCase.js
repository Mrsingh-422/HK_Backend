const mongoose = require('mongoose');

const policeCaseSchema = new mongoose.Schema({
    caseNo: { type: String, unique: true, required: true }, // e.g., FIR-2025-001
    hqId: { type: mongoose.Schema.Types.ObjectId, ref: 'PoliceHQ', required: true },
    stationId: { type: mongoose.Schema.Types.ObjectId, ref: 'PoliceStation', required: true },
    
    callerName: String,
    callerPhone: String,
    incidentType: { type: String, enum: ['Theft', 'Assault', 'Accident', 'Cyber Crime', 'Other'], default: 'Other' },
    description: String,
    address: String,
    location: {
        lat: Number,
        lng: Number
    },
    severity: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Low' },
    status: { 
        type: String, 
        enum: ['Fresh', 'Under Investigation', 'Closed', 'Archived'], 
        default: 'Fresh' 
    },
    finalStatus: String, // Figma: "Suspect Arrested", "Investigation Completed"
    reportedAt: { type: Date, default: Date.now },
    resolvedAt: Date
}, { timestamps: true });

module.exports = mongoose.model('PoliceCase', policeCaseSchema);