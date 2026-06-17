// controllers/hospital/HospitalWallet.js
const Wallet = require('../../models/Wallet');
const Appointment = require('../../models/Appointment'); // Synced with real Appointment model
const WithdrawalRequest = require('../../models/WithdrawalRequest'); // Centralized requests
const moment = require('moment');
const mongoose = require('mongoose');

// Helper to calculate Hospital specific 7-day cleared and locked balances [1.2.2]
const calculateHospitalBalances = async (hospitalId) => {
    const sevenDaysAgo = moment().subtract(7, 'days').toDate();

    // 1. Total Completed Earnings (Admissions + Appointments completed till date)
    const totalEarningsQuery = await Appointment.aggregate([
        { 
            $match: { 
                hospitalId: new mongoose.Types.ObjectId(hospitalId), 
                status: 'Completed' 
            } 
        }, 
        { $group: { _id: null, total: { $sum: "$totalAmount" } } }
    ]);
    const totalEarnings = totalEarningsQuery[0]?.total || 0;

    // 2. Cleared Earnings (Completed 7 or more days ago) - [1.2.2]
    const clearedEarningsQuery = await Appointment.aggregate([
        { 
            $match: { 
                hospitalId: new mongoose.Types.ObjectId(hospitalId), 
                status: 'Completed',
                updatedAt: { $lte: sevenDaysAgo } // Older than 7 days [1.2.2]
            } 
        }, 
        { $group: { _id: null, total: { $sum: "$totalAmount" } } }
    ]);
    const clearedEarnings = clearedEarningsQuery[0]?.total || 0;

    // 3. Pending Earnings (Completed within the last 7 days - Locked) - [1.2.2]
    const pendingEarningsQuery = await Appointment.aggregate([
        { 
            $match: { 
                hospitalId: new mongoose.Types.ObjectId(hospitalId), 
                status: 'Completed',
                updatedAt: { $gt: sevenDaysAgo } // Pichle 7 dino me completed bookings [1.2.2]
            } 
        }, 
        { $group: { _id: null, total: { $sum: "$totalAmount" } } }
    ]);
    const pendingEarnings = pendingEarningsQuery[0]?.total || 0;

    // 4. Total Payouts Requested till date (Pending or Approved)
    const totalWithdrawalsQuery = await WithdrawalRequest.aggregate([
        {
            $match: {
                vendorId: new mongoose.Types.ObjectId(hospitalId),
                vendorModel: 'Hospital',
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


// 1. GET HOSPITAL WALLET STATS (Screenshot 10)
const getHospitalWalletStats = async (req, res) => {
    try {
        const hospitalId = req.user.id;

        // Dynamic balances calculate karein
        const balances = await calculateHospitalBalances(hospitalId);

        // Daily vs Weekly stats for dashboard
        const stats = {
            todayEarnings: await Appointment.aggregate([
                { $match: { hospitalId: new mongoose.Types.ObjectId(hospitalId), status: 'Completed', updatedAt: { $gte: moment().startOf('day').toDate() } } },
                { $group: { _id: null, total: { $sum: "$totalAmount" } } }
            ]),
            weeklyEarnings: await Appointment.aggregate([
                { $match: { hospitalId: new mongoose.Types.ObjectId(hospitalId), status: 'Completed', updatedAt: { $gte: moment().subtract(7, 'days').toDate() } } },
                { $group: { _id: null, total: { $sum: "$totalAmount" } } }
            ])
        };

        const wallet = await Wallet.findOne({ vendorId: hospitalId, vendorModel: 'Hospital' });

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

// 2. REQUEST WITHDRAWAL (With 7-days dynamic locks)
const requestHospitalWithdrawal = async (req, res) => {
    try {
        const { amount } = req.body;
        const hospitalId = req.user.id;

        const wallet = await Wallet.findOne({ vendorId: hospitalId, vendorModel: 'Hospital' });
        if (!wallet) {
            return res.status(404).json({ success: false, message: "Hospital wallet not found." });
        }

        // dynamic clearance verification [1.2.2]
        const balances = await calculateHospitalBalances(hospitalId);

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
            remark: `Withdrawal Request (Hold) - Hospital Panel - ₹${amount}`,
            date: new Date()
        });
        await wallet.save();

        // B. Create request document for Centralized Admin Panel sync
        const request = await WithdrawalRequest.create({
            vendorId: hospitalId,
            vendorModel: 'Hospital', // Polymorphic mapping key [1]
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

module.exports = { getHospitalWalletStats, requestHospitalWithdrawal };