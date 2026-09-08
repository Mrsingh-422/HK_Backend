const mongoose = require('mongoose');

const maintenanceConfigSchema = new mongoose.Schema({
    isEnabled: { 
        type: Boolean, 
        default: false 
    }, // true = Website OFF (Maintenance ON), false = Website LIVE (Normal)
    heroImage: { 
        type: String, 
        default: null 
    }, // Uploaded banner image path (1425 x 715 px)
    title: { 
        type: String, 
        default: 'System Under Scheduled Maintenance' 
    },
    message: { 
        type: String, 
        default: 'Enabling Maintenance Mode will redirect all public traffic to the maintenance screen. Admins with dashboard access will still be able to preview and test the website in real-time.' 
    },
    estimatedEndTime: { 
        type: Date, 
        default: null 
    }, // Optional countdown timer
    updatedBy: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        default: null 
    }
}, { timestamps: true });

module.exports = mongoose.model('MaintenanceConfig', maintenanceConfigSchema);