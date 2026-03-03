const mongoose = require('mongoose');

const footerSchema = new mongoose.Schema({
    // Contact Info
    address: { type: String, default: '' },
    phones: [{ type: String }], // Array of strings
    emails: [{ type: String }], // Array of strings

    // About Section
    aboutTitle: { type: String, default: 'Health Kangaroo' },
    aboutDescription: { type: String, default: '' },

    // Social Media Links
    socialLinks: {
        facebook: { type: String, default: '' },
        twitter: { type: String, default: '' },
        instagram: { type: String, default: '' },
        youtube: { type: String, default: '' }
    },

    // Lists
    services: [{ type: String }], // Array of strings

    // Format: [{ name: "Privacy Policy", url: "/privacy" }]
    bottomLinks: [{ 
        name: { type: String },
        url: { type: String }
    }],

    copyrightText: { type: String, default: '' }

}, { timestamps: true });

module.exports = mongoose.model('Footer', footerSchema);