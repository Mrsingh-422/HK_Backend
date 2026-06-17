// models/WithdrawalRequest.js
const mongoose = require('mongoose');

const withdrawalRequestSchema = new mongoose.Schema({
    vendorId: { 
        type: mongoose.Schema.Types.ObjectId, 
        required: true, 
        refPath: 'vendorModel' 
    },
    vendorModel: {
        type: String,
        required: true,
        enum: ['Doctor', 'Lab', 'Pharmacy', 'Nurse', 'Hospital', 'Ambulance']
    },
    amount: { type: Number, required: true },
    
    bankDetails: {
        accountHolderName: String,
        accountNumber: String,
        ifscCode: String,
        bankName: String,
        upiId: String
    },
    
    status: { 
        type: String, 
        enum: ['Pending', 'Approved', 'Rejected'], 
        default: 'Pending' 
    },
    
    transactionReference: { type: String, default: "" }, 
    rejectionReason: { type: String, default: "" },
    
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);