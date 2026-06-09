const mongoose = require('mongoose');
 
const policeCaseSchema = new mongoose.Schema({
    // 1. Case Identity
    caseNo: {
        type: String,
        unique: true,
        required: true,
        default: () => `POLICE-${Math.floor(100000 + Math.random() * 900000)}` // POLICE-123456
    },
 
    // 2. Relations
    hqId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PoliceHQ',
        required: true
    },
    stationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PoliceStation',
        required: true
    },
    assignedStaff: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PoliceStaff' }],
    supportingStaff: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PoliceStaff' }],

    supportingStations: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PoliceStation'
    }],
    emergencyOverride: { type: Boolean, default: false },
 
    // 3. Complainant / Victim Details
    victimName: { type: String, required: true },
    victimPhone: { type: String, required: true },
    
    // 4. Incident Details
    incidentType: {
        type: String,
        enum: ['Theft', 'Assault', 'Robbery', 'Road Accident', 'Murder', 'Kidnapping', 'Drug Related', 'Cyber Crime', 'Domestic Violence', 'Other'],
        default: 'Other'
    },
    severity: {
        type: String,
        enum: ['Low', 'Medium', 'High', 'Critical'],
        default: 'Medium'
    },
    severityStatus: {
        type: String,
        enum: ['Under Investigation', 'Evidence Collection', 'Witness Statement', 'Suspect Apprehended', 'Under Control'],
        default: 'Under Investigation'
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
 
    // 6. Status Tracking
   status: {
    type: String,
    enum: ['Fresh', 'Pending', 'Accepted', 'Under Investigation', 'Critical', 'Closed', 'Archived'],
    default: 'Fresh'
},
 
    // 7. Media & Evidence (Matches Attachments Screen)
    evidence: [{
        fileName: String,
        fileUrl: String,
        fileType: { type: String, enum: ['Image', 'Video', 'Document', 'Audio'] },
        fileSize: String,
        uploadedAt: { type: Date, default: Date.now }
    }],
    cctvUrl: { type: String }, // Specifically for CCTV clips
 
    // 8. Timestamps for History
    reportedAt: { type: Date, default: Date.now },
    dispatchedAt: { type: Date },
    resolvedAt: { type: Date },
 
    // 9. Case Progress Tracking (Screen 11 logic)
    progress: {
        isAccepted: { type: Boolean, default: false },
        isSiteVisited: { type: Boolean, default: false },
        isEvidenceCollected: { type: Boolean, default: false },
        isReportSubmitted: { type: Boolean, default: false }
    },
 
    // 10. Incident Report Additional Fields
    resourcesUsed: {
        pcrVansAssigned: { type: Number, default: 0 },
        personnelCount: { type: Number, default: 0 },
        forensicTeamCalled: { type: Boolean, default: false },
        equipmentList: [String], // e.g., ["Fingerprint Kit", "Body Cams", "Breathalyzer"]
    },
    damageImpact: {
        propertyDamageValue: { type: Number, default: 0 }, // Value in Rupees as seen in Figma
        injuries: { type: Number, default: 0 },
        casualties: { type: Number, default: 0 },
        impactLevel: { type: String, enum: ['Minor', 'Major', 'Total', 'Critical Structural Damage'] }
    },
 
    remarks: { type: String }, // Officer-in-charge final notes
 
}, { timestamps: true });
 
// Geo-spatial index for location-based searching
policeCaseSchema.index({ location: "2dsphere" });
 
module.exports = mongoose.model('PoliceCase', policeCaseSchema);
 