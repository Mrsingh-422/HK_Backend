const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { getHospitalWalletStats,requestHospitalWithdrawal,updateHospitalBankDetails  } = require('../../controllers/hospital/HospitalWallet');

// Base URL: /hospital/wallet

router.get('/stats', protect('hospital'), getHospitalWalletStats);
router.post('/withdraw', protect('hospital'), requestHospitalWithdrawal);
router.patch('/bank-details', protect('hospital'), updateHospitalBankDetails); // 👈 Added


module.exports = router;
