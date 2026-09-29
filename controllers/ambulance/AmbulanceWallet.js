// controllers/ambulance/AmbulanceWallet.js
const Wallet = require('../../models/Wallet');
const Booking = require('../../models/AmbulanceBooking');
const WithdrawalRequest = require('../../models/WithdrawalRequest');
const Ambulance = require('../../models/Ambulance');
const moment = require('moment');
const mongoose = require('mongoose');
const { calculateAdminCommission } = require('../../utils/policyHelper');

// 💰 CENTRALIZED AMBULANCE LEDGER & BALANCE ENGINE
const calculateAmbulanceBalances = async (ambulanceId) => {
    const sevenDaysAgo = moment().subtract(7, 'days').toDate();
    const ambulanceObjId = new mongoose.Types.ObjectId(ambulanceId);

    // 1. Fetch Completed Trips & Compensated Cancelled/No-Show Trips
    const [allCompletedTrips, compensatedTrips] = await Promise.all([
        Booking.find({
            ambulanceId: ambulanceObjId,
            status: 'Delivered'
        }).select('serviceType pricing paymentMethod paymentStatus isFreeCase updatedAt').lean(),

        Booking.find({
            ambulanceId: ambulanceObjId,
            status: 'Cancelled',
            $or: [
                { 'pricing.cancellationFeeApplied': { $gt: 0 } },
                { 'pricing.noShowFeeApplied': { $gt: 0 } }
            ]
        }).select('serviceType pricing paymentMethod updatedAt').lean()
    ]);

    let grossEarnings = 0;
    let totalEarnings = 0;
    let adminCommissionDeducted = 0;
    let clearedEarnings = 0;
    let pendingEarnings = 0;

    // 2. Process Completed Trips (COD vs Online vs Free Case Accidental)
    for (let trip of allCompletedTrips) {
        let vendorSubtype = 'Ambulance-Medical';
        if (trip.serviceType === 'Accident emergency') vendorSubtype = 'Ambulance-Accident';
        else if (trip.serviceType === 'Referral Ambulance') vendorSubtype = 'Ambulance-Referral';

        const grossFare = Number(
            trip.pricing?.total > 0 
                ? trip.pricing.total 
                : (trip.pricing?.originalAmbulanceCharge || 2000)
        );

        grossEarnings += grossFare;

        const { netVendorAmount, adminCutoff } = await calculateAdminCommission(vendorSubtype, grossFare);
        adminCommissionDeducted += adminCutoff;

        let effectiveVendorCredit = 0;

        // 🚨 CRITICAL MARKETPLACE ACCOUNTING LOGIC:
        if (trip.isFreeCase === true || trip.serviceType === 'Accident emergency') {
            // Case A: 100% Free SOS ➔ Platform subsidizes driver wallet with Net Fare
            effectiveVendorCredit = netVendorAmount;
        } else if (trip.paymentMethod === 'COD') {
            // Case B: Cash On Delivery ➔ Driver already collected full cash physically; deduct Admin Commission from wallet
            effectiveVendorCredit = -adminCutoff;
        } else {
            // Case C: Online Payment (Razorpay) ➔ Platform collected money; credit Net Fare to driver wallet
            effectiveVendorCredit = netVendorAmount;
        }

        totalEarnings += effectiveVendorCredit;

        // 7-Day Rolling Settlement Lock
        if (new Date(trip.updatedAt) <= sevenDaysAgo) {
            clearedEarnings += effectiveVendorCredit;
        } else {
            pendingEarnings += effectiveVendorCredit;
        }
    }

    // 3. Include Driver Compensation for Cancellations & No-Shows (100% Driver's money)
    for (let compTrip of compensatedTrips) {
        const compFee = Number(compTrip.pricing?.noShowFeeApplied || compTrip.pricing?.cancellationFeeApplied || 0);
        if (compFee > 0) {
            totalEarnings += compFee;
            if (new Date(compTrip.updatedAt) <= sevenDaysAgo) {
                clearedEarnings += compFee;
            } else {
                pendingEarnings += compFee;
            }
        }
    }

    // 4. Total Withdrawals Requested
    const totalWithdrawalsQuery = await WithdrawalRequest.aggregate([
        {
            $match: {
                vendorId: ambulanceObjId,
                vendorModel: 'Ambulance',
                status: { $in: ['Pending', 'Approved'] }
            }
        },
        { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const totalWithdrawals = totalWithdrawalsQuery[0]?.total || 0;

    // 5. Active Commission Policy Details
    const AdminCommissionConfig = require('../../models/AdminCommissionConfig');
    const commissionConfig = await AdminCommissionConfig.findOne({ vendorType: 'Ambulance-Medical', isActive: true }).lean();

    return {
        grossEarnings,
        adminCommissionDeducted,
        totalEarnings,
        clearedEarnings,
        pendingEarnings,
        totalWithdrawals,
        withdrawableBalance: Math.max(0, clearedEarnings - totalWithdrawals),
        walletBalance: Math.max(0, totalEarnings - totalWithdrawals),
        commissionConfig: {
            commissionType: commissionConfig?.commissionType || 'Percentage',
            percentageValue: commissionConfig?.percentageValue ?? 10,
            fixedRupeesValue: commissionConfig?.fixedRupeesValue ?? 0
        }
    };
};

// 1. GET AMBULANCE WALLET STATS
// Endpoint: GET /driver/ambulance/wallet/stats
const getAmbulanceWalletStats = async (req, res) => {
    try {
        const ambulanceId = req.user.id;
        const ambulance = req.user;

        const balances = await calculateAmbulanceBalances(ambulanceId);

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

        let wallet = await Wallet.findOne({ vendorId: ambulanceId, vendorModel: 'Ambulance' });
        if (!wallet) {
            wallet = await Wallet.create({
                vendorId: ambulanceId,
                vendorModel: 'Ambulance',
                balance: 0,
                transactions: []
            });
        }

        res.json({ 
            success: true, 
            grossEarnings: balances.grossEarnings,                     // Total ride fare volume
            adminCommissionDeducted: balances.adminCommissionDeducted, // Total platform fee deducted
            commissionPolicy: balances.commissionConfig,               // Active commission rate
            totalBalance: balances.walletBalance,             
            withdrawableBalance: balances.withdrawableBalance,         // Cleared balance eligible for payout
            pendingBalance: balances.pendingEarnings,                  // Locked in 7-day rolling window
            bankDetails: ambulance.bankDetails || null,
            stats: {
                today: stats.todayEarnings[0]?.total || 0,
                weekly: stats.weeklyEarnings[0]?.total || 0
            },
            transactions: wallet?.transactions?.slice(-15) || [] 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. REQUEST WITHDRAWAL
// Endpoint: POST /driver/ambulance/wallet/withdraw
const requestAmbulanceWithdrawal = async (req, res) => {
    try {
        const { amount } = req.body;
        const ambulanceId = req.user.id;
        const ambulance = req.user;

        const numAmount = Number(amount);
        if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
            return res.status(400).json({ success: false, message: "Valid withdrawal amount is required." });
        }

        let wallet = await Wallet.findOne({ vendorId: ambulanceId, vendorModel: 'Ambulance' });
        if (!wallet) {
            wallet = await Wallet.create({
                vendorId: ambulanceId,
                vendorModel: 'Ambulance',
                balance: 0,
                transactions: []
            });
        }

        const balances = await calculateAmbulanceBalances(ambulanceId);

        if (balances.withdrawableBalance < numAmount) {
            return res.status(400).json({ 
                success: false, 
                message: `Insufficient cleared balance. Your current withdrawable limit is ₹${balances.withdrawableBalance}.` 
            });
        }

        if (!ambulance.bankDetails || !ambulance.bankDetails.accountNumber) {
            return res.status(400).json({ 
                success: false, 
                message: "Please add your bank account details in your profile first." 
            });
        }

        if (ambulance.bankDetails.isVerified !== true) {
            return res.status(400).json({ 
                success: false, 
                message: "Your bank details are not verified by Admin. Payouts are locked until bank verification." 
            });
        }

        // Hold amount
        wallet.balance -= numAmount;
        wallet.transactions.push({
            type: 'Debit',
            amount: numAmount,
            remark: `Withdrawal Request (Hold) - ₹${numAmount}`,
            date: new Date()
        });
        await wallet.save();

        const request = await WithdrawalRequest.create({
            vendorId: ambulanceId,
            vendorModel: 'Ambulance',
            amount: numAmount,
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
// Endpoint: GET /driver/ambulance/wallet/transactions
const getAmbulanceTransactions = async (req, res) => {
    try {
        const ambulanceId = req.user.id;

        let wallet = await Wallet.findOne({ vendorId: ambulanceId, vendorModel: 'Ambulance' });
        if (!wallet) {
            wallet = await Wallet.create({
                vendorId: ambulanceId,
                vendorModel: 'Ambulance',
                balance: 0,
                transactions: []
            });
        }

        res.json({ 
            success: true, 
            transactions: wallet?.transactions || [] 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. UPDATE AMBULANCE BANK DETAILS
// Endpoint: PATCH /driver/ambulance/wallet/bank-details
const updateAmbulanceBankDetails = async (req, res) => {
    try {
        const { accountType, bankName, accountHolderName, accountNumber, ifscCode, upiId } = req.body;
        const ambulanceId = req.user.id;

        if (!accountNumber || !ifscCode || !accountHolderName || !bankName) {
            return res.status(400).json({ success: false, message: "Bank Name, Account Holder Name, Account Number, and IFSC Code are required." });
        }

        const updatedBankDetails = {
            accountType: accountType || 'Savings',
            bankName: String(bankName).trim(),
            accountHolderName: String(accountHolderName).trim(),
            accountNumber: String(accountNumber).trim(),
            ifscCode: String(ifscCode).trim().toUpperCase(),
            upiId: upiId ? String(upiId).trim() : "",
            isVerified: false // Locked for Admin verification
        };

        const updatedAmbulance = await Ambulance.findByIdAndUpdate(
            ambulanceId,
            { $set: { bankDetails: updatedBankDetails } },
            { new: true }
        ).select('-password');

        res.json({ 
            success: true, 
            message: "Bank details updated. Payouts are locked until Admin verifies your account.", 
            data: updatedAmbulance.bankDetails 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { 
    getAmbulanceWalletStats, 
    requestAmbulanceWithdrawal, 
    getMyTransactions: getAmbulanceTransactions, 
    updateAmbulanceBankDetails 
};