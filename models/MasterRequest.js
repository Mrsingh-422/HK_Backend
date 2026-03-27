const mongoose = require('mongoose');

const masterRequestSchema = new mongoose.Schema({
    vendorId: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'vendorType' },
    vendorType: { type: String, enum: ['Lab', 'Pharmacy', 'Nurse'], required: true },
    requestType: { type: String, enum: ['Test', 'Package'], required: true },
    
    // Naya data jo Master schema me jayega
    data: { type: Object, required: true }, 
    
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    adminComment: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('MasterRequest', masterRequestSchema);