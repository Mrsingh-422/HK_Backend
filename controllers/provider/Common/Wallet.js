// controllers/provider/Common/Wallet.js
const Wallet = require('../../../models/Wallet');
const WithdrawalRequest = require('../../../models/WithdrawalRequest');
const moment = require('moment');
const mongoose = require('mongoose');

// Mapped real models to guarantee schema compilation [1]
const Lab = require('../../../models/Lab');
const Pharmacy = require('../../../models/Pharmacy');
const Nurse = require('../../../models/Nurse');
const LabBooking = require('../../../models/LabBooking');
const PharmacyBooking = require('../../../models/PharmacyBooking');
const NurseBooking = require('../../../models/NurseBooking');
const { calculateAdminCommission } = require('../../../utils/policyHelper');

// 1. CALCULATE PROVIDER BALANCES (With Strict COD vs Online & Compensations)
// =========================================================================
const calculateProviderBalances = async (vendorId, role) => {
    const sevenDaysAgo = moment().subtract(7, 'days').toDate();
    const vendorObjId = new mongoose.Types.ObjectId(vendorId);
    
    let BookingModel;
    let matchQuery = {};
    let completedStatuses = [];

    if (role === 'Lab') {
        BookingModel = LabBooking;
        matchQuery = { labId: vendorObjId };
        completedStatuses = ['Report Uploaded', 'Completed'];
    } 
    else if (role === 'Pharmacy') {
        BookingModel = PharmacyBooking;
        matchQuery = { pharmacyId: vendorObjId };
        completedStatuses = ['Delivered', 'Completed'];
    } 
    else if (role === 'Nurse') {
        BookingModel = NurseBooking;
        matchQuery = { nurseId: vendorObjId };
        completedStatuses = ['Completed'];
    } else {
        throw new Error("Invalid Provider Role inside Wallet controller.");
    }

    // 1. Fetch Completed Orders & Compensated Cancellation/No-Show Orders
    const [completedOrders, compensatedOrders] = await Promise.all([
        BookingModel.find({
            ...matchQuery,
            status: { $in: completedStatuses }
        }).select('billSummary totalPrice priceBreakdown paymentMethod paymentStatus totalConsumableCharges extraServicePayment updatedAt').lean(),

        BookingModel.find({
            ...matchQuery,
            status: { $in: ['Cancelled', 'No-Show'] },
            $or: [
                { 'billSummary.cancellationFeeApplied': { $gt: 0 } },
                { 'billSummary.noShowFeeApplied': { $gt: 0 } },
                { 'priceBreakdown.cancellationFeeApplied': { $gt: 0 } },
                { 'priceBreakdown.noShowFeeApplied': { $gt: 0 } }
            ]
        }).select('billSummary priceBreakdown paymentMethod updatedAt').lean()
    ]);

    let grossEarnings = 0;
    let totalEarnings = 0; // Net virtual balance
    let adminCommissionDeducted = 0;
    let clearedEarnings = 0;
    let pendingEarnings = 0;

    // 2. Process Completed Orders (With Doorstep Cash Add-ons Split for Nurse)
    for (let order of completedOrders) {
        let grossAmount = 0;
        if (role === 'Lab' || role === 'Pharmacy') {
            grossAmount = Number(order.billSummary?.totalAmount || order.totalPrice || 0);
        } else if (role === 'Nurse') {
            grossAmount = Number(order.priceBreakdown?.totalPrice || order.totalPrice || 0);
        }

        grossEarnings += grossAmount;

        const { netVendorAmount, adminCutoff } = await calculateAdminCommission(role, grossAmount);
        adminCommissionDeducted += adminCutoff;

        let effectiveVendorCredit = 0;

        if (order.paymentMethod === 'COD') {
            // Full COD: 100% of cash collected physically by driver; deduct admin commission from wallet
            effectiveVendorCredit = -adminCutoff;
        } else {
            // Online Order: Base amount paid online
            // Check if doorstep extra cash was collected by nurse on visit
            const doorstepCashCollected = Number(order.totalConsumableCharges || 0) + Number(order.extraServicePayment || 0);
            
            if (doorstepCashCollected > 0) {
                // Deduct physically collected cash from platform payout to prevent double credit
                effectiveVendorCredit = netVendorAmount - doorstepCashCollected;
            } else {
                effectiveVendorCredit = netVendorAmount;
            }
        }

        totalEarnings += effectiveVendorCredit;

        // 7-Day Rolling Settlement Lock
        if (new Date(order.updatedAt) <= sevenDaysAgo) {
            clearedEarnings += effectiveVendorCredit;
        } else {
            pendingEarnings += effectiveVendorCredit;
        }
    }

    // 3. Process Compensations (100% Vendor's earnings for customer fault)
    for (let compOrder of compensatedOrders) {
        let compFee = 0;
        if (role === 'Lab' || role === 'Pharmacy') {
            compFee = Number(compOrder.billSummary?.cancellationFeeApplied || compOrder.billSummary?.noShowFeeApplied || 0);
        } else if (role === 'Nurse') {
            compFee = Number(compOrder.priceBreakdown?.cancellationFeeApplied || compOrder.priceBreakdown?.noShowFeeApplied || 0);
        }

        if (compFee > 0) {
            totalEarnings += compFee;
            if (new Date(compOrder.updatedAt) <= sevenDaysAgo) {
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
                vendorId: vendorObjId,
                vendorModel: role,
                status: { $in: ['Pending', 'Approved'] }
            }
        },
        { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const totalWithdrawals = totalWithdrawalsQuery[0]?.total || 0;

    // 5. Active Commission Policy Details
    const AdminCommissionConfig = require('../../../models/AdminCommissionConfig');
    const commissionConfig = await AdminCommissionConfig.findOne({ vendorType: role, isActive: true }).lean();

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

// 1. GET PROVIDER EARNING STATS (With Transparent Commission Breakdown)
const getWalletStats = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const role = req.user.role; // 'Lab', 'Pharmacy', or 'Nurse'
        const provider = req.user; 

        // Dynamic balances calculate karein
        const balances = await calculateProviderBalances(vendorId, role);

        // LAZY INITIALIZATION
        let wallet = await Wallet.findOne({ vendorId, vendorModel: role });
        if (!wallet) {
            wallet = await Wallet.create({
                vendorId,
                vendorModel: role,
                balance: 0,
                transactions: []
            });
            console.log(`[Wallet] Self-Healed: Created wallet for Provider (${role}): ${vendorId}`);
        }

        res.json({ 
            success: true, 
            providerRole: role,
            grossEarnings: balances.grossEarnings,                     // 👈 Total business generated before commission
            adminCommissionDeducted: balances.adminCommissionDeducted, // 👈 Total platform fee deducted
            commissionPolicy: balances.commissionConfig,               // 👈 Active commission rate (e.g. 10%)
            totalBalance: balances.walletBalance,                      // Net virtual earnings
            withdrawableBalance: balances.withdrawableBalance,         // Cleared balance
            pendingBalance: balances.pendingEarnings,                  // Locked in 7-day period
            bankDetails: provider.bankDetails || null,
            transactions: wallet?.transactions?.slice(-10) || []
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 4. GET FULL TRANSACTIONS HISTORY (Newly Added for Lab, Pharmacy, Nurse)
const getProviderTransactions = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const role = req.user.role;

        let wallet = await Wallet.findOne({ vendorId, vendorModel: role });
        if (!wallet) {
            wallet = await Wallet.create({
                vendorId,
                vendorModel: role,
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

// 2. PROVIDER WITHDRAWAL REQUEST
const requestWithdrawal = async (req, res) => {
    try {
        const { amount } = req.body;
        const vendorId = req.user.id;
        const role = req.user.role; // 'Lab', 'Pharmacy', or 'Nurse'
        const provider = req.user;  

        // 🚨 LAZY INITIALIZATION: Agar Wallet nahi mila, toh auto-initialize karein [1]
        let wallet = await Wallet.findOne({ vendorId, vendorModel: role });
        if (!wallet) {
            wallet = await Wallet.create({
                vendorId,
                vendorModel: role,
                balance: 0,
                transactions: []
            });
            console.log(`[Wallet] Self-Healed on Payout: Created wallet for Provider (${role}): ${vendorId}`);
        }

        // Calculate dynamic balances using lock checks
        const balances = await calculateProviderBalances(vendorId, role);

        // requested amount check against withdrawableBalance
        if (balances.withdrawableBalance < amount) {
            return res.status(400).json({ 
                success: false, 
                message: `Insufficient withdrawable balance. Your available limit is ₹${balances.withdrawableBalance}.` 
            });
        }

        // STRICTOR RULE 1: Ensure Bank details are not empty [1]
        if (!provider.bankDetails || !provider.bankDetails.accountNumber) {
            return res.status(400).json({ 
                success: false, 
                message: "Please update your bank details in your provider profile settings first." 
            });
        }

        // STRICTOR RULE 2: Block requests unless bank details are verified by Admin! [1]
        if (provider.bankDetails.isVerified !== true) {
            return res.status(400).json({ 
                success: false, 
                message: "Your bank details are not verified by Admin. Payouts are strictly blocked for unverified bank accounts." 
            });
        }

        // Hold amount
        wallet.balance -= amount;
        wallet.transactions.push({ 
            type: 'Debit', 
            amount: amount, 
            remark: `Withdrawal Request (Hold) - ₹${amount}` 
        });
        await wallet.save();

        // Create a unified withdrawal request for Admin Panel
        const request = await WithdrawalRequest.create({
            vendorId,
            vendorModel: role, // Dynamically maps to Lab, Pharmacy, or Nurse
            amount,
            bankDetails: {
                accountHolderName: provider.bankDetails.accountHolderName,
                accountNumber: provider.bankDetails.accountNumber,
                ifscCode: provider.bankDetails.ifscCode,
                bankName: provider.bankDetails.bankName,
                upiId: provider.bankDetails.upiId || ""
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

// 3. UPDATE PROVIDER BANK DETAILS (Strict verification reset & Geo-indexing bypass) - [1]
const updateProviderBankDetails = async (req, res) => {
    try {
        const { accountType, bankName, accountHolderName, accountNumber, ifscCode, upiId } = req.body;
        const vendorId = req.user.id;
        const role = req.user.role; // 'Lab', 'Pharmacy', or 'Nurse'

        if (!accountNumber || !ifscCode || !accountHolderName || !bankName) {
            return res.status(400).json({ success: false, message: "Missing required bank details fields." });
        }

        // SECURITY GUARD: Reset verification status to false on any change [1]
        const updatedBankDetails = {
            accountType: accountType || 'Savings',
            bankName,
            accountHolderName,
            accountNumber,
            ifscCode,
            upiId: upiId || "",
            isVerified: false // Locked for admin re-verification [1]
        };

        // Determine correct collection dynamically [1]
        let VendorModel;
        if (role === 'Lab') VendorModel = Lab;
        else if (role === 'Pharmacy') VendorModel = Pharmacy;
        else if (role === 'Nurse') VendorModel = Nurse;

        // CRITICAL FIX: Use findByIdAndUpdate to bypass 2dsphere indexing and full-document validation bugs!
        const updatedVendor = await VendorModel.findByIdAndUpdate(
            vendorId,
            { $set: { bankDetails: updatedBankDetails } },
            { new: true }
        );

        res.json({ 
            success: true, 
            message: "Bank details updated successfully. Payouts are locked until Admin verifies your account.", 
            data: updatedVendor.bankDetails 
        });
    } catch (error) {
        console.error("updateProviderBankDetails Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getWalletStats,getProviderTransactions, requestWithdrawal, updateProviderBankDetails };