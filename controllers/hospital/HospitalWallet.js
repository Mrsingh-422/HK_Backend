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
        const hospital = req.user; // Decoded profile carries fresh bankDetails [1]

        const balances = await calculateHospitalBalances(hospitalId);

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
            totalBalance: balances.walletBalance,             
            withdrawableBalance: balances.withdrawableBalance,      
            pendingBalance: balances.pendingEarnings,         
            bankDetails: hospital.bankDetails || null, // 👈 Read dynamically from Hospital profile [1]
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

// 2. REQUEST WITHDRAWAL (With 7-days dynamic locks)
// Replacing requestHospitalWithdrawal inside controllers/hospital/HospitalWallet.js
const requestHospitalWithdrawal = async (req, res) => {
    try {
        const { amount } = req.body;
        const hospitalId = req.user.id;
        const hospital = req.user; // Decoded and populated via protect('hospital') middleware

        const wallet = await Wallet.findOne({ vendorId: hospitalId, vendorModel: 'Hospital' });
        if (!wallet) {
            return res.status(404).json({ success: false, message: "Hospital wallet not found." });
        }

        // dynamic clearance verification
        const balances = await calculateHospitalBalances(hospitalId);

        if (balances.withdrawableBalance < amount) {
            return res.status(400).json({ 
                success: false, 
                message: `Insufficient withdrawable balance. Your available limit is ₹${balances.withdrawableBalance}.` 
            });
        }

        // 🚨 STRICTOR RULE 1: Ensure Bank details are not empty [1]
        if (!hospital.bankDetails || !hospital.bankDetails.accountNumber) {
            return res.status(400).json({ 
                success: false, 
                message: "Please update your bank details in your hospital profile first." 
            });
        }

        // 🚨 STRICTOR RULE 2: Block requests unless bank details are verified by Admin! [1]
        if (hospital.bankDetails.isVerified !== true) {
            return res.status(400).json({ 
                success: false, 
                message: "Your bank details are not verified by Admin. Hospital payouts are strictly blocked for unverified accounts." 
            });
        }

        // Hold amount
        wallet.balance -= amount;
        wallet.transactions.push({
            type: 'Debit',
            amount: amount,
            remark: `Withdrawal Request (Hold) - Hospital Panel - ₹${amount}`,
            date: new Date()
        });
        await wallet.save();

        // Create request document with verified bank details [1]
        const request = await WithdrawalRequest.create({
            vendorId: hospitalId,
            vendorModel: 'Hospital',
            amount,
            bankDetails: {
                accountHolderName: hospital.bankDetails.accountHolderName,
                accountNumber: hospital.bankDetails.accountNumber,
                ifscCode: hospital.bankDetails.ifscCode,
                bankName: hospital.bankDetails.bankName,
                upiId: hospital.bankDetails.upiId || ""
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

// 3. UPDATE HOSPITAL BANK DETAILS (Strict verification reset) - [1]
const updateHospitalBankDetails = async (req, res) => {
    try {
        const { accountType, bankName, accountHolderName, accountNumber, ifscCode, upiId } = req.body;

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

        req.user.bankDetails = updatedBankDetails;
        await req.user.save();

        res.json({ 
            success: true, 
            message: "Hospital bank details updated successfully. Payouts are locked until Admin verifies your account.", 
            data: updatedBankDetails 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getHospitalWalletStats, requestHospitalWithdrawal, updateHospitalBankDetails };