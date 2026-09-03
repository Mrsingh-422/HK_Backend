// controllers/doctor/DoctorWallet.js
const Wallet = require('../../models/Wallet');
const Appointment = require('../../models/Appointment'); 
const WithdrawalRequest = require('../../models/WithdrawalRequest'); 
const moment = require('moment');
const mongoose = require('mongoose');
const { calculateAdminCommission } = require('../../utils/policyHelper');


// Helper function to calculate all dynamic balances for a vendor
const calculateVendorBalances = async (vendorId) => {
    const sevenDaysAgo = moment().subtract(7, 'days').toDate();
    const doctorObjId = new mongoose.Types.ObjectId(vendorId);

    // 1. Fetch all completed appointments
    const completedAppointments = await Appointment.find({
        doctorId: doctorObjId,
        status: 'Completed'
    }).select('totalAmount updatedAt').lean();

    let totalEarnings = 0;
    let clearedEarnings = 0;
    let pendingEarnings = 0;

    // 🚨 2. Deduct Admin Commission for each completed appointment
    for (let appt of completedAppointments) {
        const grossAmount = Number(appt.totalAmount || 0);
        const { netVendorAmount } = await calculateAdminCommission('Doctor', grossAmount);

        totalEarnings += netVendorAmount;

        // 7-Day Rolling Cleared vs Locked Calculation
        if (new Date(appt.updatedAt) <= sevenDaysAgo) {
            clearedEarnings += netVendorAmount;
        } else {
            pendingEarnings += netVendorAmount;
        }
    }

    // 3. Total Withdrawals requested till date
    const totalWithdrawalsQuery = await WithdrawalRequest.aggregate([
        {
            $match: {
                vendorId: doctorObjId,
                vendorModel: 'Doctor',
                status: { $in: ['Pending', 'Approved'] }
            }
        },
        { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const totalWithdrawals = totalWithdrawalsQuery[0]?.total || 0;

    return {
        totalEarnings,
        clearedEarnings,
        pendingEarnings, // Locked balance (last 7 days)
        totalWithdrawals,
        withdrawableBalance: Math.max(0, clearedEarnings - totalWithdrawals), // Cleared for payout
        walletBalance: Math.max(0, totalEarnings - totalWithdrawals)          // Total virtual balance
    };
};


// 1. GET DOCTOR EARNING STATS
const getDoctorWalletStats = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const doctor = req.user; // Decoded profile carries fresh bankDetails [1]

        const balances = await calculateVendorBalances(doctorId);

        const stats = {
            today: await Appointment.aggregate([
                { $match: { doctorId: new mongoose.Types.ObjectId(doctorId), status: 'Completed', updatedAt: { $gte: moment().startOf('day').toDate() } } }, 
                { $group: { _id: null, total: { $sum: "$totalAmount" } } }
            ]),
            weekly: await Appointment.aggregate([
                { $match: { doctorId: new mongoose.Types.ObjectId(doctorId), status: 'Completed', updatedAt: { $gte: moment().subtract(7, 'days').toDate() } } }, 
                { $group: { _id: null, total: { $sum: "$totalAmount" } } }
            ]),
        };

        res.json({ 
            success: true, 
            totalBalance: balances.walletBalance,
            withdrawableBalance: balances.withdrawableBalance,
            pendingBalance: balances.pendingEarnings,
            todayEarning: stats.today[0]?.total || 0,
            weeklyEarning: stats.weekly[0]?.total || 0,
            bankDetails: doctor.bankDetails || null // 👈 Read dynamically from Doctor profile [1]
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
        const doctor = req.user; // Decoded and populated via protect('doctor') middleware

        const wallet = await Wallet.findOne({ vendorId: doctorId, vendorModel: 'Doctor' });
        if (!wallet) {
            return res.status(404).json({ success: false, message: "Wallet not found." });
        }

        // Calculate dynamic balances using lock checks
        const balances = await calculateVendorBalances(doctorId);

        if (balances.withdrawableBalance < amount) {
            return res.status(400).json({ 
                success: false, 
                message: `Insufficient withdrawable balance. Your available limit is ₹${balances.withdrawableBalance}.` 
            });
        }

        // 🚨 STRICTOR RULE 1: Ensure Bank details are not empty [1]
        if (!doctor.bankDetails || !doctor.bankDetails.accountNumber) {
            return res.status(400).json({ 
                success: false, 
                message: "Please update your bank details in your profile settings first." 
            });
        }

        // 🚨 STRICTOR RULE 2: Block requests unless bank details are verified by Admin! [1]
        if (doctor.bankDetails.isVerified !== true) {
            return res.status(400).json({ 
                success: false, 
                message: "Your bank details are not verified by Admin. Payouts are strictly allowed only to verified bank accounts to prevent fraud." 
            });
        }

        // Hold amount from current virtual balance
        wallet.balance -= amount;
        wallet.transactions.push({ 
            type: 'Debit', 
            amount: amount, 
            remark: `Withdrawal Request (Hold) - ₹${amount}` 
        });
        await wallet.save();

        // Create request document with verified bank details [1]
        const request = await WithdrawalRequest.create({
            vendorId: doctorId,
            vendorModel: 'Doctor',
            amount,
            bankDetails: {
                accountHolderName: doctor.bankDetails.accountHolderName,
                accountNumber: doctor.bankDetails.accountNumber,
                ifscCode: doctor.bankDetails.ifscCode,
                bankName: doctor.bankDetails.bankName,
                upiId: doctor.bankDetails.upiId || ""
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

// 4. UPDATE DOCTOR BANK DETAILS (Strict verification reset) - [1]
const updateDoctorBankDetails = async (req, res) => {
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
            message: "Bank details updated successfully. Payouts are locked until Admin verifies your account.", 
            data: updatedBankDetails 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getDoctorWalletStats, requestDoctorWithdrawal, getDoctorTransactions,updateDoctorBankDetails };