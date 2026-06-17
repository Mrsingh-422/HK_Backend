// models/Wallet.js
const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
    vendorId: { 
        type: mongoose.Schema.Types.ObjectId, 
        required: true, 
        refPath: 'vendorModel' 
    },
    vendorModel: {
        type: String,
        required: true,
        // 👈 Expanded to support all unified vendor collections
        enum: ['Doctor', 'Lab', 'Pharmacy', 'Nurse', 'Hospital', 'Ambulance'] 
    },
    balance: { type: Number, default: 0 },
    transactions: [{
        type: { type: String, enum: ['Credit', 'Debit'] },
        amount: Number,
        remark: String, 
        orderId: String, // Booking ID reference
        date: { type: Date, default: Date.now }
    }],
    bankDetails: {
        accountType: { type: String, enum: ['Savings', 'Current'] },
        bankName: String,
        accountHolderName: String,
        accountNumber: String,
        ifscCode: String,
        isVerified: { type: Boolean, default: false }
    }
}, { timestamps: true });

module.exports = mongoose.model('Wallet', walletSchema);