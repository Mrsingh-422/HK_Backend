const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { 
    getDoctorWalletStats, 
    requestDoctorWithdrawal, 
    getDoctorTransactions ,updateDoctorBankDetails
} = require('../../controllers/doctor/DoctorWallet');

// Base URL: /doctor/wallet

router.get('/stats', protect('doctor'), getDoctorWalletStats);
router.post('/withdraw', protect('doctor'), requestDoctorWithdrawal);
router.get('/transactions', protect('doctor'), getDoctorTransactions);
router.patch('/bank-details', protect('doctor'), updateDoctorBankDetails);
module.exports = router;