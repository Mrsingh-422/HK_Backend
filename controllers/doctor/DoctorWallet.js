// controllers/doctor/DoctorWallet.js
const Wallet = require('../../models/Wallet');
const Appointment = require('../../models/Appointment'); 
const WithdrawalRequest = require('../../models/WithdrawalRequest'); 
const moment = require('moment');
const mongoose = require('mongoose');

// Helper function to calculate all dynamic balances for a vendor
const calculateVendorBalances = async (vendorId) => {
    const sevenDaysAgo = moment().subtract(7, 'days').toDate();

    // 1. Total Completed Earnings (Aaj tak ki total kamai)
    const totalEarningsQuery = await Appointment.aggregate([
        { 
            $match: { 
                doctorId: new mongoose.Types.ObjectId(vendorId), 
                status: 'Completed' 
            } 
        }, 
        { $group: { _id: null, total: { $sum: "$totalAmount" } } }
    ]);
    const totalEarnings = totalEarningsQuery[0]?.total || 0;

    // 2. Cleared Earnings (Appointments completed 7 or more days ago) - [1.2.2]
    const clearedEarningsQuery = await Appointment.aggregate([
        { 
            $match: { 
                doctorId: new mongoose.Types.ObjectId(vendorId), 
                status: 'Completed',
                updatedAt: { $lte: sevenDaysAgo } // 👈 7 din ya usse purani completed bookings
            } 
        }, 
        { $group: { _id: null, total: { $sum: "$totalAmount" } } }
    ]);
    const clearedEarnings = clearedEarningsQuery[0]?.total || 0;

    // 3. Pending Earnings (Completed within the last 7 days - Locked) - [1.2.2]
    const pendingEarningsQuery = await Appointment.aggregate([
        { 
            $match: { 
                doctorId: new mongoose.Types.ObjectId(vendorId), 
                status: 'Completed',
                updatedAt: { $gt: sevenDaysAgo } // 👈 Pichle 7 dino me completed bookings
            } 
        }, 
        { $group: { _id: null, total: { $sum: "$totalAmount" } } }
    ]);
    const pendingEarnings = pendingEarningsQuery[0]?.total || 0;

    // 4. Total Withdrawals requested till date (Pending or Approved)
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

    // 5. Final Balances Calculations
    const withdrawableBalance = Math.max(0, clearedEarnings - totalWithdrawals); // Payout target balance
    const walletBalance = Math.max(0, totalEarnings - totalWithdrawals);       // Total virtual balance

    return {
        totalEarnings,
        clearedEarnings,
        pendingEarnings, // Locked balance
        totalWithdrawals,
        withdrawableBalance, // Available to request
        walletBalance
    };
};


// 1. GET DOCTOR EARNING STATS
const getDoctorWalletStats = async (req, res) => {
    try {
        const doctorId = req.user.id;

        // Dynamic Balances calculate karein
        const balances = await calculateVendorBalances(doctorId);

        // Standard stats for cards (Today vs Weekly earnings)
        const todayStart = moment().startOf('day').toDate();
        const weeklyStart = moment().subtract(7, 'days').toDate();

        const stats = {
            today: await Appointment.aggregate([
                { 
                    $match: { 
                        doctorId: new mongoose.Types.ObjectId(doctorId), 
                        status: 'Completed', 
                        updatedAt: { $gte: todayStart } 
                    } 
                }, 
                { $group: { _id: null, total: { $sum: "$totalAmount" } } }
            ]),
            weekly: await Appointment.aggregate([
                { 
                    $match: { 
                        doctorId: new mongoose.Types.ObjectId(doctorId), 
                        status: 'Completed', 
                        updatedAt: { $gte: weeklyStart } 
                    } 
                }, 
                { $group: { _id: null, total: { $sum: "$totalAmount" } } }
            ]),
        };

        const wallet = await Wallet.findOne({ vendorId: doctorId, vendorModel: 'Doctor' });

        res.json({ 
            success: true, 
            totalBalance: balances.walletBalance,        // Cleared + Uncleared virtual remaining balance
            withdrawableBalance: balances.withdrawableBalance, // 👈 Cleared balance older than 7 days (Available to withdraw)
            pendingBalance: balances.pendingEarnings,    // 👈 Locked balance (Completed within last 7 days)
            todayEarning: stats.today[0]?.total || 0,
            weeklyEarning: stats.weekly[0]?.total || 0,
            bankDetails: wallet?.bankDetails || null
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. DOCTOR WITHDRAWAL REQUEST (With strict 7-day Lock Period validation)
const requestDoctorWithdrawal = async (req, res) => {
    try {
        const { amount } = req.body;
        const doctorId = req.user.id;

        const wallet = await Wallet.findOne({ vendorId: doctorId, vendorModel: 'Doctor' });
        if (!wallet) {
            return res.status(404).json({ success: false, message: "Wallet not found." });
        }

        // A. Dynamic verification against cleared/withdrawable balance
        const balances = await calculateVendorBalances(doctorId);

        // requested amount should not exceed cleared balance
        if (balances.withdrawableBalance < amount) {
            return res.status(400).json({ 
                success: false, 
                message: `Insufficient withdrawable balance. You have ₹${balances.pendingEarnings} locked under 7-day clearance period. Current available withdrawable limit is ₹${balances.withdrawableBalance}.` 
            });
        }

        if (!wallet.bankDetails || (!wallet.bankDetails.accountNumber && !wallet.bankDetails.upiId)) {
            return res.status(400).json({ success: false, message: "Please update your bank details first." });
        }

        // B. Hold/Deduct amount from current virtual balance
        wallet.balance -= amount;
        wallet.transactions.push({ 
            type: 'Debit', 
            amount: amount, 
            remark: `Withdrawal Request (Hold) - ₹${amount}` 
        });

        await wallet.save();

        // C. Create request document for Admin Panel sync
        const request = await WithdrawalRequest.create({
            vendorId: doctorId,
            vendorModel: 'Doctor',
            amount,
            bankDetails: {
                accountHolderName: wallet.bankDetails.accountHolderName,
                accountNumber: wallet.bankDetails.accountNumber,
                ifscCode: wallet.bankDetails.ifscCode,
                bankName: wallet.bankDetails.bankName,
                upiId: wallet.bankDetails.upiId
            },
            status: 'Pending'
        });

        res.json({ 
            success: true, 
            message: "Withdrawal request submitted successfully. Waiting for admin manual payout approval.",
            data: request 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 3. GET TRANSACTION HISTORY
const getDoctorTransactions = async (req, res) => {
    try {
        const wallet = await Wallet.findOne({ vendorId: req.user.id, vendorModel: 'Doctor' });
        res.json({ success: true, transactions: wallet?.transactions || [] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getDoctorWalletStats, requestDoctorWithdrawal, getDoctorTransactions };