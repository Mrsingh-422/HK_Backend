// routes/ambulance/AmbulanceWallet.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware'); // protect middleware
const { 
    getAmbulanceWalletStats, 
    requestAmbulanceWithdrawal, 
    getMyTransactions ,updateAmbulanceBankDetails
} = require('../../controllers/ambulance/AmbulanceWallet');

// Base URL: /driver/ambulance/wallet

// 🚨 STRICT: Only independent ambulance driver role is protected
router.get('/stats', protect('ambulance'), getAmbulanceWalletStats);
router.post('/withdraw', protect('ambulance'), requestAmbulanceWithdrawal);
router.get('/transactions', protect('ambulance'), getMyTransactions);
router.patch('/bank-details', protect('ambulance'), updateAmbulanceBankDetails);

module.exports = router;