const Wallet = require('../../models/Wallet');
const Appointment = require('../../models/Appointment');
const moment = require('moment');

// 1. GET HOSPITAL WALLET STATS (Screenshot 10)
const getHospitalWalletStats = async (req, res) => {
    try {
        const hospitalId = req.user.id;

        const stats = {
            todayEarnings: await Appointment.aggregate([
                { $match: { hospitalId: req.user._id, status: 'Completed', updatedAt: { $gte: moment().startOf('day').toDate() } } },
                { $group: { _id: null, total: { $sum: "$totalAmount" } } }
            ]),
            weeklyEarnings: await Appointment.aggregate([
                { $match: { hospitalId: req.user._id, status: 'Completed', updatedAt: { $gte: moment().subtract(7, 'days').toDate() } } },
                { $group: { _id: null, total: { $sum: "$totalAmount" } } }
            ])
        };

        const wallet = await Wallet.findOne({ vendorId: hospitalId });

        res.json({ 
            success: true, 
            balance: wallet?.balance || 0, 
            bankDetails: wallet?.bankDetails || null,
            stats: {
                today: stats.todayEarnings[0]?.total || 0,
                weekly: stats.weeklyEarnings[0]?.total || 0
            },
            transactions: wallet?.transactions.slice(-10) || [] // Last 10 transactions
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. REQUEST WITHDRAWAL
const requestHospitalWithdrawal = async (req, res) => {
    try {
        const { amount } = req.body;
        const wallet = await Wallet.findOne({ vendorId: req.user.id });

        if (!wallet || wallet.balance < amount) {
            return res.status(400).json({ message: "Insufficient balance for withdrawal" });
        }

        // Deduct balance and record transaction
        wallet.balance -= amount;
        wallet.transactions.push({
            type: 'Debit',
            amount: amount,
            remark: "Withdrawal Request - Hospital Panel",
            date: new Date()
        });

        await wallet.save();
        res.json({ success: true, message: "Withdrawal request submitted to Admin" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { getHospitalWalletStats, requestHospitalWithdrawal };