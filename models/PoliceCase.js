// models/PoliceCase.js (Production Version)
const mongoose = require('mongoose');

const policeCaseSchema = new mongoose.Schema({
    caseNo: {
        type: String,
        unique: true,
        required: true,
        default: () => `POLICE-${Math.floor(100000 + Math.random() * 900000)}`
    },
    hqId: { type: mongoose.Schema.Types.ObjectId, ref: 'PoliceHQ', required: true },
    stationId: { type: mongoose.Schema.Types.ObjectId, ref: 'PoliceStation', required: true },
    assignedStaff: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PoliceStaff' }],
    supportingStaff: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PoliceStaff' }],
    supportingStations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PoliceStation' }],
    emergencyOverride: { type: Boolean, default: false },

    // Complainant / Victim Details (Figma Screen 34)
    victimName: { type: String, required: true },
    victimPhone: { type: String, required: true },
    complainantName: { type: String, default: null }, // 👈 Added for Complainant Name

    // Accused & IPC Legal Mapping (Figma Screen 34)
    accusedName: { type: String, default: null }, // 👈 Added for Accused tracking
    ipcSections: [{ type: String }],             // 👈 Added (e.g. ["420", "506"])
  
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
enum: [
            'Site Visit Completed', 
            'Evidence Collected', 
            'Suspect Identified', 
            'Suspect Arrested', 
            'Awaiting Approval', 
            'Investigation Ongoing',
            'Under Investigation', 
            'Evidence Collection', 
            'Witness Statement', 
            'Suspect Apprehended', 
            'Under Control'
        ],        
        default: 'Under Investigation'
    },
    severityLevel: { type: String, default: 'Level 1' },
    description: { type: String },

    // Location
    address: { type: String, required: true },
    location: {
        lat: { type: Number, required: true },
        lng: { type: Number, required: true }
    },
    responseTime: { type: String },

    status: {
        type: String,
        enum: ['Fresh', 'Pending','Accepted', 'Under Investigation', 'On Hold', 'Critical', 'Closed', 'Archived'],
        default: 'Fresh'
    },

    // 🚨 Figma Screen 4 & 5 Integration: Transport Details (Linked with Ambulance & Hospital)
    transportDetails: {
        ambulanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ambulance', default: null },
        ambulanceNumber: { type: String, default: null }, // e.g. "PB65AM0001"
        driverName: { type: String, default: null },      // e.g. "Kunal"
        hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },
        hospitalName: { type: String, default: null }     // e.g. "Radius Hospital"
    },

    // 🚨 Figma Screen 34 Integration: Legal Progress tracking
    legalProgress: {
        arrestStatus: { type: String, enum: ['Arrested', 'Not Arrested', 'Fled'], default: 'Not Arrested' },
        bailStatus: { type: String, enum: ['Pending', 'Approved', 'Denied', 'N/A'], default: 'Pending' },
        courtDate: { type: Date, default: null },
        isChargeSheetFiled: { type: Boolean, default: false }
    },

    evidence: [{
        fileName: String,
        fileUrl: String,
        fileType: { type: String, enum: ['Image', 'Video', 'Document', 'Audio'] },
        fileSize: String,
        uploadedAt: { type: Date, default: Date.now }
    }],
    cctvUrl: { type: String },

    // Timestamps
    reportedAt: { type: Date, default: Date.now },
    incidentDateTime: { type: Date, default: null }, // 👈 Actual event timestamp (Figma Screen 34)
    dispatchedAt: { type: Date },
    resolvedAt: { type: Date },

    progress: {
        isAccepted: { type: Boolean, default: false },
        isSiteVisited: { type: Boolean, default: false },
        isEvidenceCollected: { type: Boolean, default: false },
        isReportSubmitted: { type: Boolean, default: false }
    },

    resourcesUsed: {
        pcrVansAssigned: { type: Number, default: 0 },
        personnelCount: { type: Number, default: 0 },
        forensicTeamCalled: { type: Boolean, default: false },
        equipmentList: [String]
    },
    damageImpact: {
        propertyDamageValue: { type: Number, default: 0 },
        injuries: { type: Number, default: 0 },
        casualties: { type: Number, default: 0 },
        impactLevel: { type: String, enum: ['Minor', 'Major', 'Total', 'Critical Structural Damage'] }
    },
    remarks: { type: String },
    transferDetails: {
        transferredTo: { type: mongoose.Schema.Types.ObjectId, ref: 'PoliceStation', default: null },
        transferredReason: { type: String, default: null }, // e.g. "Jurisdiction Change", "Online Fraud"
        transferredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PoliceStaff', default: null },
        transferredAt: { type: Date, default: null }
    }

}, { timestamps: true });

policeCaseSchema.index({ location: "2dsphere" });

module.exports = mongoose.model('PoliceCase', policeCaseSchema);