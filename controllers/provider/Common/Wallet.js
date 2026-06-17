// controllers/provider/Common/Wallet.js
const Wallet = require('../../../models/Wallet');
const WithdrawalRequest = require('../../../models/WithdrawalRequest');
const moment = require('moment');
const mongoose = require('mongoose');

// Helper to dynamically resolve booking model and run aggregate calculations based on Provider Type
const calculateProviderBalances = async (vendorId, role) => {
    const sevenDaysAgo = moment().subtract(7, 'days').toDate();
    
    let BookingModel;
    let matchQuery = {};
    let sumField = "$totalAmount"; // Default
    let completedStatuses = ['Completed'];

    // 🚨 Dynamic Model Resolution based on active login role [1]
    if (role === 'Lab') {
        BookingModel = mongoose.model('LabBooking');
        matchQuery = { labId: new mongoose.Types.ObjectId(vendorId) };
        sumField = "$billSummary.totalAmount"; // As per your lab aggregate schema
        completedStatuses = ['Report Uploaded', 'Completed'];
    } 
    else if (role === 'Pharmacy') {
        // Safe check: Fallback dynamically if PharmacyOrder is not compiled yet
        BookingModel = mongoose.models.PharmacyOrder || mongoose.models.PharmacyBooking || mongoose.model('PharmacyOrder', new mongoose.Schema({}));
        matchQuery = { pharmacyId: new mongoose.Types.ObjectId(vendorId) };
        completedStatuses = ['Delivered', 'Completed'];
    } 
    else if (role === 'Nurse') {
        BookingModel = mongoose.models.NurseBooking || mongoose.model('NurseBooking', new mongoose.Schema({}));
        matchQuery = { nurseId: new mongoose.Types.ObjectId(vendorId) };
        completedStatuses = ['Completed'];
    } else {
        throw new Error("Invalid Provider Role inside Wallet controller.");
    }

    // A. Calculate Total Earnings till date
    const totalEarningsQuery = await BookingModel.aggregate([
        { $match: { ...matchQuery, status: { $in: completedStatuses } } },
        { $group: { _id: null, total: { $sum: sumField } } }
    ]);
    const totalEarnings = totalEarningsQuery[0]?.total || 0;

    // B. Calculate Cleared Earnings (Older than 7 days) - [1.2.2]
    const clearedEarningsQuery = await BookingModel.aggregate([
        { 
            $match: { 
                ...matchQuery, 
                status: { $in: completedStatuses },
                updatedAt: { $lte: sevenDaysAgo } // 7-day period completed - [1.2.2]
            } 
        },
        { $group: { _id: null, total: { $sum: sumField } } }
    ]);
    const clearedEarnings = clearedEarningsQuery[0]?.total || 0;

    // C. Calculate Pending Earnings (Within last 7 days - Locked) - [1.2.2]
    const pendingEarningsQuery = await BookingModel.aggregate([
        { 
            $match: { 
                ...matchQuery, 
                status: { $in: completedStatuses },
                updatedAt: { $gt: sevenDaysAgo } // Completed within last 7 days - [1.2.2]
            } 
        },
        { $group: { _id: null, total: { $sum: sumField } } }
    ]);
    const pendingEarnings = pendingEarningsQuery[0]?.total || 0;

    // D. Calculate total requested withdrawals (Pending/Approved)
    const totalWithdrawalsQuery = await WithdrawalRequest.aggregate([
        {
            $match: {
                vendorId: new mongoose.Types.ObjectId(vendorId),
                status: { $in: ['Pending', 'Approved'] }
            }
        },
        { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const totalWithdrawals = totalWithdrawalsQuery[0]?.total || 0;

    return {
        totalEarnings,
        clearedEarnings,
        pendingEarnings,
        withdrawableBalance: Math.max(0, clearedEarnings - totalWithdrawals),
        walletBalance: Math.max(0, totalEarnings - totalWithdrawals)
    };
};

// 1. GET PROVIDER EARNING STATS
const getWalletStats = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const role = req.user.role; // 'Lab', 'Pharmacy', or 'Nurse'

        // Dynamic balances calculate karein
        const balances = await calculateProviderBalances(vendorId, role);

        // Fetch wallet details
        const wallet = await Wallet.findOne({ vendorId, vendorModel: role });

        res.json({ 
            success: true, 
            providerRole: role,
            totalBalance: balances.walletBalance,             // Uncleared + Cleared remaining balance
            withdrawableBalance: balances.withdrawableBalance,      // 👈 Available after 7 days - [1.2.2]
            pendingBalance: balances.pendingEarnings,         // 👈 Locked earnings (pichle 7 dino ki) - [1.2.2]
            bankDetails: wallet?.bankDetails || null,
            transactions: wallet?.transactions || []
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. PROVIDER WITHDRAWAL REQUEST
const requestWithdrawal = async (req, res) => {
    try {
        const { amount } = req.body;
        const vendorId = req.user.id;
        const role = req.user.role; // 'Lab', 'Pharmacy', or 'Nurse'

        const wallet = await Wallet.findOne({ vendorId, vendorModel: role });
        if (!wallet) {
            return res.status(404).json({ success: false, message: "Wallet record not found." });
        }

        // Calculate dynamic balances using lock check
        const balances = await calculateProviderBalances(vendorId, role);

        // requested amount check against withdrawableBalance
        if (balances.withdrawableBalance < amount) {
            return res.status(400).json({ 
                success: false, 
                message: `Insufficient withdrawable balance. You have ₹${balances.pendingEarnings} locked under 7-day clearance period. Available limit is ₹${balances.withdrawableBalance}.` 
            });
        }

        if (!wallet.bankDetails || (!wallet.bankDetails.accountNumber)) {
            return res.status(400).json({ success: false, message: "Please update your bank details first." });
        }

        // A. Hold amount from virtual balance
        wallet.balance -= amount;
        wallet.transactions.push({ 
            type: 'Debit', 
            amount: amount, 
            remark: `Withdrawal Request (Hold) - ₹${amount}` 
        });
        await wallet.save();

        // B. Create a unified withdrawal request for Admin Panel
        const request = await WithdrawalRequest.create({
            vendorId,
            vendorModel: role, // Dynamically maps to Lab, Pharmacy, or Nurse
            amount,
            bankDetails: {
                accountHolderName: wallet.bankDetails.accountHolderName,
                accountNumber: wallet.bankDetails.accountNumber,
                ifscCode: wallet.bankDetails.ifscCode,
                bankName: wallet.bankDetails.bankName,
                upiId: wallet.bankDetails.upiId || ""
            },
            status: 'Pending'
        });

        res.json({ 
            success: true, 
            message: "Withdrawal request submitted successfully. Waiting for Admin manual payout.",
            data: request 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

module.exports = { getWalletStats, requestWithdrawal };