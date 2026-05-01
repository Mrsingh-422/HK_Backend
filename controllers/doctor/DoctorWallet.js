const Wallet = require('../../models/Wallet');
// const DoctorBooking = require('../../models/DoctorBooking'); // Make sure this model exists
const moment = require('moment');

// 1. GET DOCTOR EARNING STATS
const getDoctorWalletStats = async (req, res) => {
    try {
        const doctorId = req.user.id;

        // Statistics calculation (Sirf 'Completed' ya 'Approved' appointments ki earning)
        const stats = {
            today: await DoctorBooking.aggregate([
                { 
                    $match: { 
                        doctorId: req.user._id, 
                        status: 'Completed', 
                        updatedAt: { $gte: moment().startOf('day').toDate() } 
                    } 
                }, 
                { $group: { _id: null, total: { $sum: "$totalAmount" } } }
            ]),
            weekly: await DoctorBooking.aggregate([
                { 
                    $match: { 
                        doctorId: req.user._id, 
                        status: 'Completed', 
                        updatedAt: { $gte: moment().subtract(7, 'days').toDate() } 
                    } 
                }, 
                { $group: { _id: null, total: { $sum: "$totalAmount" } } }
            ]),
        };

        const wallet = await Wallet.findOne({ vendorId: doctorId, vendorModel: 'Doctor' });

        res.json({ 
            success: true, 
            balance: wallet?.balance || 0, 
            todayEarning: stats.today[0]?.total || 0,
            weeklyEarning: stats.weekly[0]?.total || 0,
            bankDetails: wallet?.bankDetails || null
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. DOCTOR WITHDRAWAL REQUEST
const requestDoctorWithdrawal = async (req, res) => {
    try {
        const { amount } = req.body;
        const wallet = await Wallet.findOne({ vendorId: req.user.id, vendorModel: 'Doctor' });

        if (!wallet || wallet.balance < amount) {
            return res.status(400).json({ success: false, message: "Insufficient balance" });
        }

        // Logic: Balance kam karo aur transaction add karo
        wallet.balance -= amount;
        wallet.transactions.push({ 
            type: 'Debit', 
            amount: amount, 
            remark: "Withdrawal Request Submitted" 
        });

        await wallet.save();
        res.json({ success: true, message: "Withdrawal request submitted successfully" });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 3. GET TRANSACTION HISTORY
const getDoctorTransactions = async (req, res) => {
    try {
        const wallet = await Wallet.findOne({ vendorId: req.user.id });
        res.json({ success: true, transactions: wallet?.transactions || [] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getDoctorWalletStats, requestDoctorWithdrawal, getDoctorTransactions };