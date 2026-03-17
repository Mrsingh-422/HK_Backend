// controllers/provider/Common/Wallet.js
const Wallet = require('../../../models/Wallet');
const LabBooking = require('../../../models/LabBooking');
const moment = require('moment');

// 1. GET EARNING STATS
// endpoint: GET /api/provider/common/wallet/stats
const getWalletStats = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const stats = {
            today: await LabBooking.aggregate([{ $match: { labId: req.user._id, status: 'Report Uploaded', updatedAt: { $gte: moment().startOf('day').toDate() } } }, { $group: { _id: null, total: { $sum: "$billSummary.totalAmount" } } }]),
            weekly: await LabBooking.aggregate([{ $match: { labId: req.user._id, status: 'Report Uploaded', updatedAt: { $gte: moment().subtract(7, 'days').toDate() } } }, { $group: { _id: null, total: { $sum: "$billSummary.totalAmount" } } }]),
        };
        const wallet = await Wallet.findOne({ vendorId });
        res.json({ success: true, balance: wallet?.balance || 0, stats });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. WITHDRAW
// endpoint: POST /api/provider/common/wallet/withdraw
const requestWithdrawal = async (req, res) => {
    try {
        const wallet = await Wallet.findOne({ vendorId: req.user.id });
        if (wallet.balance < req.body.amount) return res.status(400).json({ message: "Insufficient balance" });
        wallet.balance -= req.body.amount;
        wallet.transactions.push({ type: 'Debit', amount: req.body.amount, remark: "Withdrawal Request" });
        await wallet.save();
        res.json({ success: true, message: "Request Submitted" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { getWalletStats, requestWithdrawal };