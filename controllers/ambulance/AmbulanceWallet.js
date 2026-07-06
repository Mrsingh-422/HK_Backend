// controllers/ambulance/AmbulanceWallet.js
const Wallet = require('../../models/Wallet');
const Booking = require('../../models/AmbulanceBooking'); // Synced with AmbulanceBooking model
const WithdrawalRequest = require('../../models/WithdrawalRequest');
const Ambulance = require('../../models/Ambulance'); // 👈 Imported Ambulance model (fixes profile update)
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
        const ambulance = req.user; // Decoded profile carries fresh bankDetails [1]

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

        // 🚨 LAZY INITIALIZATION: Agar Wallet nahi mila, toh auto-initialize karein [1]
        let wallet = await Wallet.findOne({ vendorId: ambulanceId, vendorModel: 'Ambulance' });
        if (!wallet) {
            wallet = await Wallet.create({
                vendorId: ambulanceId,
                vendorModel: 'Ambulance',
                balance: 0,
                transactions: []
            });
            console.log(`[Wallet] Self-Healed: Created new wallet for Ambulance ${ambulanceId}`);
        }

        res.json({ 
            success: true, 
            totalBalance: balances.walletBalance,             
            withdrawableBalance: balances.withdrawableBalance,      
            pendingBalance: balances.pendingEarnings,         
            bankDetails: ambulance.bankDetails || null, // 👈 Read dynamically from Ambulance profile [1]
            stats: {
                today: stats.todayEarnings[0]?.total || 0,
                weekly: stats.weeklyEarnings[0]?.total || 0
            },
            transactions: wallet?.transactions.slice(-10) || [] 
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
        const ambulance = req.user; // Decoded and populated via protect('ambulance') middleware

        // 🚨 LAZY INITIALIZATION: Agar Wallet nahi mila, toh auto-initialize karein [1]
        let wallet = await Wallet.findOne({ vendorId: ambulanceId, vendorModel: 'Ambulance' });
        if (!wallet) {
            wallet = await Wallet.create({
                vendorId: ambulanceId,
                vendorModel: 'Ambulance',
                balance: 0,
                transactions: []
            });
            console.log(`[Wallet] Self-Healed on Payout: Created wallet for Ambulance ${ambulanceId}`);
        }

        // dynamic lock verification
        const balances = await calculateAmbulanceBalances(ambulanceId);

        if (balances.withdrawableBalance < amount) {
            return res.status(400).json({ 
                success: false, 
                message: `Insufficient withdrawable balance. Your available limit is ₹${balances.withdrawableBalance}.` 
            });
        }

        // 🚨 STRICTOR RULE 1: Ensure Bank details are not empty [1]
        if (!ambulance.bankDetails || !ambulance.bankDetails.accountNumber) {
            return res.status(400).json({ 
                success: false, 
                message: "Please update your bank details in your driver profile first." 
            });
        }

        // 🚨 STRICTOR RULE 2: Block requests unless bank details are verified by Admin! [1]
        if (ambulance.bankDetails.isVerified !== true) {
            return res.status(400).json({ 
                success: false, 
                message: "Your bank details are not verified by Admin. Ambulance payouts are strictly blocked for unverified accounts." 
            });
        }

        // Hold amount
        wallet.balance -= amount;
        wallet.transactions.push({
            type: 'Debit',
            amount: amount,
            remark: `Withdrawal Request (Hold) - Ambulance Panel - ₹${amount}`,
            date: new Date()
        });
        await wallet.save();

        // Create request document with verified bank details [1]
        const request = await WithdrawalRequest.create({
            vendorId: ambulanceId,
            vendorModel: 'Ambulance',
            amount,
            bankDetails: {
                accountHolderName: ambulance.bankDetails.accountHolderName,
                accountNumber: ambulance.bankDetails.accountNumber,
                ifscCode: ambulance.bankDetails.ifscCode,
                bankName: ambulance.bankDetails.bankName,
                upiId: ambulance.bankDetails.upiId || ""
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
        const ambulanceId = req.user.id;

        // 🚨 LAZY INITIALIZATION: Agar Wallet nahi mila, toh auto-initialize karein [1]
        let wallet = await Wallet.findOne({ vendorId: ambulanceId, vendorModel: 'Ambulance' });
        if (!wallet) {
            wallet = await Wallet.create({
                vendorId: ambulanceId,
                vendorModel: 'Ambulance',
                balance: 0,
                transactions: []
            });
            console.log(`[Wallet] Self-Healed on Tx History: Created wallet for Ambulance ${ambulanceId}`);
        }

        res.json({ success: true, transactions: wallet?.transactions || [] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. UPDATE AMBULANCE BANK DETAILS (Strict verification reset & Geo-indexing bypass) - [1]
const updateAmbulanceBankDetails = async (req, res) => {
    try {
        const { accountType, bankName, accountHolderName, accountNumber, ifscCode, upiId } = req.body;
        const ambulanceId = req.user.id;

        if (!accountNumber || !ifscCode || !accountHolderName || !bankName) {
            return res.status(400).json({ success: false, message: "Missing required bank details fields." });
        }

        // 🚨 SECURITY GUARD: Reset verification status to false on any change [1]
        const updatedBankDetails = {
            accountType: accountType || 'Savings',
            bankName,
            accountHolderName,
            accountNumber,
            ifscCode,
            upiId: upiId || "",
            isVerified: false // Locked for admin re-verification [1]
        };

        // 🚨 CRITICAL FIX: Use findByIdAndUpdate to bypass 2dsphere indexing and full-document validation bugs!
        const updatedAmbulance = await Ambulance.findByIdAndUpdate(
            ambulanceId,
            { $set: { bankDetails: updatedBankDetails } },
            { new: true }
        );

        res.json({ 
            success: true, 
            message: "Ambulance driver bank details updated successfully. Payouts are locked until Admin verifies your account.", 
            data: updatedAmbulance.bankDetails 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getAmbulanceWalletStats, requestAmbulanceWithdrawal, getMyTransactions: getAmbulanceTransactions, updateAmbulanceBankDetails };