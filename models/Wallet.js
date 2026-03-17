// models/Wallet.js
const mongoose = require('mongoose');
const walletSchema = new mongoose.Schema({
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true },
    balance: { type: Number, default: 0 },
    transactions: [{
        type: { type: String, enum: ['Credit', 'Debit'] },
        amount: Number,
        remark: String, // e.g., "Order #123 earnings"
        userId: String,
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