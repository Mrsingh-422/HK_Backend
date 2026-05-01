const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { 
    getDoctorWalletStats, 
    requestDoctorWithdrawal, 
    getDoctorTransactions 
} = require('../../controllers/doctor/DoctorWallet');

// Base URL: /doctor/wallet

router.get('/stats', protect('doctor'), getDoctorWalletStats);
router.post('/withdraw', protect('doctor'), requestDoctorWithdrawal);
router.get('/transactions', protect('doctor'), getDoctorTransactions);

module.exports = router;