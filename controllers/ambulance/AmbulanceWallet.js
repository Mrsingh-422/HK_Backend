// controllers/ambulance/AmbulanceWallet.js
const Wallet = require('../../models/Wallet');
const Booking = require('../../models/AmbulanceBooking'); // Synced with AmbulanceBooking model
const WithdrawalRequest = require('../../models/WithdrawalRequest');
const moment = require('moment');
const mongoose = require('mongoose');

// Helper to calculate Ambulance specific 7-day cleared and locked balances [1.2.2]
const calculateAmbulanceBalances = async (ambulanceId) => {
    const sevenDaysAgo = moment().subtract(7, 'days').toDate();

    // 1. Total Completed Earnings (Trips with status 'Delivered')
    const totalEarningsQuery = await Booking.aggregate([
        { 
            $match: { 
                ambulanceId: new mongoose.Types.ObjectId(ambulanceId), 
                status: 'Delivered' 
            } 
        }, 
        { $group: { _id: null, total: { $sum: "$pricing.total" } } }
    ]);
    const totalEarnings = totalEarningsQuery[0]?.total || 0;

    // 2. Cleared Earnings (Trips completed 7 or more days ago) - [1.2.2]
    const clearedEarningsQuery = await Booking.aggregate([
        { 
            $match: { 
                ambulanceId: new mongoose.Types.ObjectId(ambulanceId), 
                status: 'Delivered',
                updatedAt: { $lte: sevenDaysAgo } // Older than 7 days [1.2.2]
            } 
        }, 
        { $group: { _id: null, total: { $sum: "$pricing.total" } } }
    ]);
    const clearedEarnings = clearedEarningsQuery[0]?.total || 0;

    // 3. Pending Earnings (Completed within the last 7 days - Locked) - [1.2.2]
    const pendingEarningsQuery = await Booking.aggregate([
        { 
            $match: { 
                ambulanceId: new mongoose.Types.ObjectId(ambulanceId), 
                status: 'Delivered',
                updatedAt: { $gt: sevenDaysAgo } // Completed within last 7 days [1.2.2]
            } 
        }, 
        { $group: { _id: null, total: { $sum: "$pricing.total" } } }
    ]);
    const pendingEarnings = pendingEarningsQuery[0]?.total || 0;

    // 4. Total Payouts Requested till date (Pending or Approved)
    const totalWithdrawalsQuery = await WithdrawalRequest.aggregate([
        {
            $match: {
                vendorId: new mongoose.Types.ObjectId(ambulanceId),
                vendorModel: 'Ambulance',
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


// 1. GET AMBULANCE WALLET STATS
const getAmbulanceWalletStats = async (req, res) => {
    try {
        const ambulanceId = req.user.id;

        // Dynamic balances calculate karein [1.2.2]
        const balances = await calculateAmbulanceBalances(ambulanceId);

        // Daily vs Weekly stats for dashboard
        const stats = {
            todayEarnings: await Booking.aggregate([
                { $match: { ambulanceId: new mongoose.Types.ObjectId(ambulanceId), status: 'Delivered', updatedAt: { $gte: moment().startOf('day').toDate() } } },
                { $group: { _id: null, total: { $sum: "$pricing.total" } } }
            ]),
            weeklyEarnings: await Booking.aggregate([
                { $match: { ambulanceId: new mongoose.Types.ObjectId(ambulanceId), status: 'Delivered', updatedAt: { $gte: moment().subtract(7, 'days').toDate() } } },
                { $group: { _id: null, total: { $sum: "$pricing.total" } } }
            ])
        };

        const wallet = await Wallet.findOne({ vendorId: ambulanceId, vendorModel: 'Ambulance' });

        res.json({ 
            success: true, 
            totalBalance: balances.walletBalance,             // Uncleared + Cleared remaining virtual balance
            withdrawableBalance: balances.withdrawableBalance,      // 👈 Available (completed >= 7 days ago) - [1.2.2]
            pendingBalance: balances.pendingEarnings,         // 👈 Locked (completed within last 7 days) - [1.2.2]
            bankDetails: wallet?.bankDetails || null,
            stats: {
                today: stats.todayEarnings[0]?.total || 0,
                weekly: stats.weeklyEarnings[0]?.total || 0
            },
            transactions: wallet?.transactions.slice(-10) || [] // Last 10 transactions
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. REQUEST WITHDRAWAL
const requestAmbulanceWithdrawal = async (req, res) => {
    try {
        const { amount } = req.body;
        const ambulanceId = req.user.id;

        const wallet = await Wallet.findOne({ vendorId: ambulanceId, vendorModel: 'Ambulance' });
        if (!wallet) {
            return res.status(404).json({ success: false, message: "Ambulance wallet not found." });
        }

        // dynamic lock verification [1.2.2]
        const balances = await calculateAmbulanceBalances(ambulanceId);

        if (balances.withdrawableBalance < amount) {
            return res.status(400).json({ 
                success: false, 
                message: `Insufficient withdrawable balance. You have ₹${balances.pendingEarnings} locked under 7-day clearance period. Available limit to request is ₹${balances.withdrawableBalance}.` 
            });
        }

        if (!wallet.bankDetails || !wallet.bankDetails.accountNumber) {
            return res.status(400).json({ success: false, message: "Please update your bank details first." });
        }

        // A. Hold amount from current virtual balance
        wallet.balance -= amount;
        wallet.transactions.push({
            type: 'Debit',
            amount: amount,
            remark: `Withdrawal Request (Hold) - Ambulance Panel - ₹${amount}`,
            date: new Date()
        });
        await wallet.save();

        // B. Create request document for Centralized Admin Panel sync
        const request = await WithdrawalRequest.create({
            vendorId: ambulanceId,
            vendorModel: 'Ambulance', // Polymorphic mapping key [1]
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
            message: "Withdrawal request submitted successfully to Admin.",
            data: request 
        });

    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 3. GET TRANSACTION HISTORY
const getAmbulanceTransactions = async (req, res) => {
    try {
        const wallet = await Wallet.findOne({ vendorId: req.user.id, vendorModel: 'Ambulance' });
        res.json({ success: true, transactions: wallet?.transactions || [] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getAmbulanceWalletStats, requestAmbulanceWithdrawal, getMyTransactions: getAmbulanceTransactions };