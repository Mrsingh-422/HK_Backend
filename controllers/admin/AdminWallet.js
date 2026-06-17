// controllers/admin/AdminWallet.js
const WithdrawalRequest = require('../../models/WithdrawalRequest');
const Wallet = require('../../models/Wallet');

// 1. GET ALL PENDING WITHDRAWALS (Admin dashboard lists all doctors, labs, nurses requests) - [1.2.2]
const getPendingWithdrawals = async (req, res) => {
    try {
        const list = await WithdrawalRequest.find({ status: 'Pending' })
            .populate({
                path: 'vendorId',
                select: 'name email phone speciality licenseNumber' // Polymorphic auto-lookup
            })
            .sort({ createdAt: -1 });

        res.json({ success: true, count: list.length, data: list });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. APPROVE WITHDRAWAL (Using manual payment UTR/Reference ID)
const approveWithdrawal = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { transactionReference } = req.body; 

        if (!transactionReference) {
            return res.status(400).json({ success: false, message: "Manual payout UTR reference code is mandatory." });
        }

        const request = await WithdrawalRequest.findById(requestId);
        if (!request || request.status !== 'Pending') {
            return res.status(404).json({ success: false, message: "Active pending withdrawal request not found." });
        }

        request.status = 'Approved';
        request.transactionReference = transactionReference;
        request.approvedAt = new Date();
        await request.save();

        // Finalize transaction details in the vendor's wallet
        const wallet = await Wallet.findOne({ vendorId: request.vendorId, vendorModel: request.vendorModel });
        if (wallet) {
            const lastTransaction = wallet.transactions[wallet.transactions.length - 1];
            if (lastTransaction && lastTransaction.type === 'Debit') {
                lastTransaction.remark = `Withdrawal Approved (UTR Ref: ${transactionReference})`;
            }
            await wallet.save();
        }

        res.json({ success: true, message: "Withdrawal approved successfully.", data: request });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. REJECT WITHDRAWAL (Refunds the locked balance back to vendor)
const rejectWithdrawal = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { reason } = req.body; 

        const request = await WithdrawalRequest.findById(requestId);
        if (!request || request.status !== 'Pending') {
            return res.status(404).json({ success: false, message: "Active pending withdrawal request not found." });
        }

        request.status = 'Rejected';
        request.rejectionReason = reason || "Declined by Admin";
        request.rejectedAt = new Date();
        await request.save();

        // 🚨 Refund safety mechanism
        const wallet = await Wallet.findOne({ vendorId: request.vendorId, vendorModel: request.vendorModel });
        if (wallet) {
            wallet.balance += request.amount; // Refund held amount
            wallet.transactions.push({
                type: 'Credit',
                amount: request.amount,
                remark: `Withdrawal Declined Refund (Reason: ${request.rejectionReason})`
            });
            await wallet.save();
        }

        res.json({ success: true, message: "Withdrawal request rejected. Balance refunded to vendor wallet.", data: request });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getPendingWithdrawals, approveWithdrawal, rejectWithdrawal };