const mongoose = require('mongoose');

const teamMemberSchema = new mongoose.Schema({
    // In your frontend, you are using 'specialization' as the main title, 
    // but usually, a doctor has a name. Adding both for flexibility.
    name: { type: String, default: 'Doctor' }, 
    specialization: { type: String, required: true }, 
    description: { type: String, required: true },
    image: { type: String }, // URL to image
    
    // Social & Contact
    facebook: { type: String },
    twitter: { type: String },
    phone: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('TeamMember', teamMemberSchema);